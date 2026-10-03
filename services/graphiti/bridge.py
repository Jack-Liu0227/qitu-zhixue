"""Private deterministic projection bridge. No chat extraction, LLM or embedding calls."""
import argparse
import asyncio
import hashlib
import hmac
import json
import math
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote, urlparse
from uuid import NAMESPACE_URL, uuid5

os.environ['GRAPHITI_TELEMETRY_ENABLED'] = 'false'
FIELDS = {'id', 'schoolId', 'studentId', 'knowledgePointId', 'courseVersion', 'objectiveId', 'planId', 'projectId',
          'eventType', 'knowledgeType', 'score', 'confidence', 'qualitativeMastered', 'validFrom', 'recordedAt',
          'sequence', 'evidenceRefs', 'sourceType', 'sourceEventId', 'causationId', 'correlationId',
          'supersedesEventId', 'assessmentVersion', 'idempotencyKey'}


def validate(payload, key):
    if not isinstance(payload, dict) or set(payload) != {'projectionKey', 'payloadHash', 'event'}:
        raise ValueError('GRAPHITI_INPUT_INVALID')
    event = payload['event']
    if not isinstance(event, dict) or set(event) != FIELDS or payload['projectionKey'] != key or key != 'mastery-event:' + event.get('id', ''):
        raise ValueError('GRAPHITI_INPUT_INVALID')
    if not isinstance(payload['payloadHash'], str) or len(payload['payloadHash']) != 64 or any(c not in '0123456789abcdef' for c in payload['payloadHash']):
        raise ValueError('GRAPHITI_INPUT_INVALID')
    for field in ['id', 'studentId', 'knowledgePointId', 'courseVersion', 'sourceEventId', 'assessmentVersion', 'idempotencyKey']:
        value = event[field]
        if not isinstance(value, str) or not value or len(value) > 200:
            raise ValueError('GRAPHITI_INPUT_INVALID')
    if type(event['sequence']) is not int or event['sequence'] < 1:
        raise ValueError('GRAPHITI_INPUT_INVALID')
    if event['eventType'] not in ['assessed', 'corrected', 'revoked', 'imported'] or event['knowledgeType'] not in ['memory', 'procedure', 'concept', 'design']:
        raise ValueError('GRAPHITI_INPUT_INVALID')
    for field in ['score', 'confidence']:
        value = event[field]
        if value is not None and (type(value) not in [int, float] or not math.isfinite(value) or not 0 <= value <= 1):
            raise ValueError('GRAPHITI_INPUT_INVALID')
    if event['qualitativeMastered'] is not None and type(event['qualitativeMastered']) is not bool:
        raise ValueError('GRAPHITI_INPUT_INVALID')
    for field in ['validFrom', 'recordedAt']:
        value = datetime.fromisoformat(event[field].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError('GRAPHITI_INPUT_INVALID')
    refs = event['evidenceRefs']
    if not isinstance(refs, list) or len(refs) > 20 or any(not isinstance(ref, str) or len(ref) > 200 or ':' not in ref or '/' in ref for ref in refs):
        raise ValueError('GRAPHITI_INPUT_INVALID')
    return event


def node_ids(event):
    group = 'qitu-mastery-' + hashlib.sha256(json.dumps([event['schoolId'], event['studentId']], separators=(',', ':')).encode()).hexdigest()
    student = str(uuid5(NAMESPACE_URL, group + ':student'))
    kp = str(uuid5(NAMESPACE_URL, group + ':' + json.dumps([event['knowledgePointId'], event['courseVersion']], separators=(',', ':'))))
    return group, student, kp


async def execute(method, key, payload=None, initialize=False):
    # Import only when configured and called; importing the bridge never needs model credentials.
    from graphiti_core.driver.neo4j_driver import Neo4jDriver
    from graphiti_core.edges import EntityEdge
    driver = Neo4jDriver(uri=os.environ['GRAPHITI_NEO4J_URI'], user=os.environ['GRAPHITI_NEO4J_USER'], password=os.environ['GRAPHITI_NEO4J_PASSWORD'])
    try:
        if method == 'HEALTH':
            await driver.execute_query('RETURN 1 AS ready', routing_='r')
            return {'ready': True}
        if initialize:
            await driver.execute_query('CREATE CONSTRAINT qitu_mastery_entity_uuid IF NOT EXISTS FOR (n:Entity) REQUIRE n.uuid IS UNIQUE')
            return {'ready': True}
        edge_id = str(uuid5(NAMESPACE_URL, key))
        if method == 'GET':
            rows, _, _ = await driver.execute_query('MATCH ()-[e:RELATES_TO {uuid: $uuid}]->() RETURN e.qitu_projection_key AS projectionKey, e.qitu_payload_hash AS payloadHash, e.uuid AS projectionId', uuid=edge_id, routing_='r')
            return dict(rows[0]) if rows else None
        event = validate(payload, key)
        group, student, kp = node_ids(event)
        edge = EntityEdge(uuid=edge_id, group_id=group, source_node_uuid=student, target_node_uuid=kp,
                          name='HAS_MASTERY_ASSESSMENT', fact='Server-validated mastery assessment',
                          created_at=datetime.fromisoformat(event['recordedAt'].replace('Z', '+00:00')),
                          valid_at=datetime.fromisoformat(event['validFrom'].replace('Z', '+00:00')),
                          reference_time=datetime.fromisoformat(event['validFrom'].replace('Z', '+00:00')),
                          episodes=[], attributes={})
        # One query atomically MERGEs a deterministic immutable edge; no close-old/write-new sequence.
        rows, _, _ = await driver.execute_query('''
            MERGE (s:Entity {uuid: $student}) ON CREATE SET s.group_id = $group_id, s.name = 'Student', s.labels = ['Student'], s.summary = '', s.created_at = $created_at
            MERGE (k:Entity {uuid: $kp}) ON CREATE SET k.group_id = $group_id, k.name = $kp_name, k.labels = ['KnowledgePoint'], k.summary = '', k.created_at = $created_at
            MERGE (s)-[e:RELATES_TO {uuid: $uuid}]->(k)
            ON CREATE SET e.group_id = $group_id, e.name = $name, e.fact = $fact, e.created_at = $created_at,
              e.valid_at = $valid_at, e.reference_time = $reference_time, e.episodes = [],
              e.qitu_projection_key = $projection_key, e.qitu_payload_hash = $payload_hash, e.qitu_event_json = $event_json,
              e.qitu_sequence = $sequence, e.qitu_event_type = $event_type
            WITH e WHERE e.qitu_payload_hash = $payload_hash
            RETURN e.qitu_projection_key AS projectionKey, e.qitu_payload_hash AS payloadHash, e.uuid AS projectionId
        ''', student=student, kp=kp, group_id=group, kp_name=event['knowledgePointId'], uuid=edge.uuid,
            name=edge.name, fact=edge.fact, created_at=edge.created_at, valid_at=edge.valid_at, reference_time=edge.reference_time,
            projection_key=key, payload_hash=payload['payloadHash'], sequence=event['sequence'], event_type=event['eventType'],
            event_json=json.dumps(event, separators=(',', ':'), ensure_ascii=False))
        if not rows:
            raise ValueError('GRAPHITI_IDEMPOTENCY_CONFLICT')
        return dict(rows[0])
    finally:
        await driver.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Do not log identifiers, bodies or authorization headers.

    def do_GET(self):
        self.handle_projection('GET')

    def do_PUT(self):
        self.handle_projection('PUT')

    def handle_projection(self, method):
        token = os.environ.get('QITU_GRAPHITI_TOKEN', '')
        supplied = self.headers.get('Authorization', '')
        if not token or not hmac.compare_digest(supplied, 'Bearer ' + token):
            return self.respond(401, {'code': 'GRAPHITI_UNAUTHORIZED'})
        path = unquote(urlparse(self.path).path)
        if path == '/health' and method == 'GET':
            try:
                return self.respond(200, asyncio.run(execute('HEALTH', '')))
            except Exception:
                return self.respond(503, {'code': 'GRAPHITI_UNAVAILABLE'})
        prefix = '/v1/mastery/projections/'
        if not path.startswith(prefix):
            return self.respond(404, {'code': 'GRAPHITI_NOT_FOUND'})
        key = path[len(prefix):]
        try:
            payload = None
            if method == 'PUT':
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 32768:
                    raise ValueError('GRAPHITI_INPUT_INVALID')
                payload = json.loads(self.rfile.read(length))
                validate(payload, key)
            result = asyncio.run(execute(method, key, payload))
            self.respond(200 if result else 404, result or {'code': 'GRAPHITI_NOT_FOUND'})
        except ValueError as error:
            self.respond(409 if str(error) == 'GRAPHITI_IDEMPOTENCY_CONFLICT' else 400, {'code': str(error) if str(error).startswith('GRAPHITI_') else 'GRAPHITI_INPUT_INVALID'})
        except Exception:
            self.respond(503, {'code': 'GRAPHITI_UNAVAILABLE'})

    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--init-schema', action='store_true')
    parser.add_argument('--port', type=int, default=4180)
    parser.add_argument('--host', default='127.0.0.1', choices=['127.0.0.1', '0.0.0.0'])
    options = parser.parse_args()
    for name in ['QITU_GRAPHITI_TOKEN', 'GRAPHITI_NEO4J_URI', 'GRAPHITI_NEO4J_USER', 'GRAPHITI_NEO4J_PASSWORD']:
        if not os.environ.get(name):
            raise SystemExit('Required Graphiti configuration is missing')
    if options.init_schema:
        asyncio.run(execute('INIT', '', initialize=True))
    else:
        HTTPServer((options.host, options.port), Handler).serve_forever()
