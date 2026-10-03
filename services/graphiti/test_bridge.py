import unittest
from bridge import validate, node_ids


def payload():
    event = dict(id='e1', schoolId='school1', studentId='student1', knowledgePointId='kp1', courseVersion='v1',
                 objectiveId='o1', planId='p1', projectId='pr1', eventType='assessed', knowledgeType='procedure',
                 score=0.9, confidence=None, qualitativeMastered=None, validFrom='2026-01-01T00:00:00Z',
                 recordedAt='2026-01-02T00:00:00Z', sequence=1, evidenceRefs=['attempt:a1'], sourceType='quiz',
                 sourceEventId='a1', causationId=None, correlationId=None, supersedesEventId=None,
                 assessmentVersion='qitu.mastery.v1', idempotencyKey='k1')
    return dict(projectionKey='mastery-event:e1', payloadHash='a' * 64, event=event)


class BridgeTests(unittest.TestCase):
    def test_structured_event(self):
        item = payload()
        self.assertEqual(validate(item, item['projectionKey'])['id'], 'e1')

    def test_reject_raw_conversation(self):
        item = payload()
        item['event']['conversation'] = 'not allowed'
        with self.assertRaises(ValueError):
            validate(item, item['projectionKey'])

    def test_scope_and_version_isolation(self):
        item = payload()['event']
        group, student, kp = node_ids(item)
        self.assertEqual(node_ids(item), (group, student, kp))
        item['courseVersion'] = 'v2'
        self.assertNotEqual(node_ids(item)[2], kp)
        item['studentId'] = 'other'
        self.assertNotEqual(node_ids(item)[0], group)

    def test_invalid_level_and_timestamp(self):
        item = payload()
        item['event']['score'] = 1.1
        with self.assertRaises(ValueError):
            validate(item, item['projectionKey'])
        item = payload()
        item['event']['validFrom'] = '2026-01-01T00:00:00'
        with self.assertRaises(ValueError):
            validate(item, item['projectionKey'])


if __name__ == '__main__':
    unittest.main()
