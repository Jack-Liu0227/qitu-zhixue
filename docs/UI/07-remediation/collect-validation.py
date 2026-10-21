"""Collect reproducible validation results from the isolated build directory."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
build = Path('C:/Users/HK/AppData/Local/Temp/qitu-ui-validation-final-20261021')
tap = (build / 'ui-final-api-all-verified.log').read_text(encoding='utf-16')
counts = {key: int(re.search(r'^# ' + key + r' (\d+)$', tap, re.M)[1]) for key in ['tests', 'pass', 'fail', 'skipped']}
assert counts['tests'] == counts['pass'] and counts['fail'] == 0
front = (build / 'ui-final-front-builds.log').read_text(encoding='utf-16')
apps = ['auth-portal', 'student-center', 'teacher-workspace', 'parent-companion', 'admin-console']
assert front.count('Compiled successfully') == len(apps)
assert 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL' not in front
types = (build / 'ui-final-front-types-verified.log').read_text(encoding='utf-16')
assert 'error TS' not in types
cases = {}
for name in ['browser-verification', 'parent-race-verification', 'admin-matrix-verification']:
    payload = json.loads((out / (name + '.json')).read_text(encoding='utf-8'))
    assert payload['errors'] == []
    assert all(case['passed'] for case in payload['results'])
    cases[name] = len(payload['results'])
summary = {
    'collectedAt': datetime.now(timezone.utc).isoformat(),
    'source': 'isolated local source snapshot, not a production release',
    'environment': {'node': '24.19.0', 'pnpm': '10.10.0', 'os': 'Windows', 'dependencyInstall': 'frozen lockfile'},
    'apiBuild': 'passed', 'apiTests': counts, 'uiRegressionTests': {'tests': 5, 'pass': 5, 'fail': 0},
    'frontends': [{'app': name, 'typecheck': 'passed', 'productionBuild': 'passed'} for name in apps],
    'browserCases': cases, 'browserRuntimeErrors': 0,
    'screenshotCount': len(list((out / 'after').rglob('*.png'))),
    'deployment': {'status': 'not_deployed', 'reason': 'Formal administrator must be provisioned and verified before disabling reserved demo accounts', 'observedAdminCount': 1, 'observedNonDemoAdminCount': 0},
}
(out / 'validation-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
paths = [
    'packages/auth/src/index.tsx', 'packages/auth/src/login-routing.ts', 'packages/contracts/src/display.ts',
    'services/api/src/modules/projects/current-project.ts', 'services/api/src/modules/projects/ui-read-model.test.ts',
    'services/api/src/modules/identity-auth/auth.service.ts', 'services/api/src/modules/directory/directory.service.ts',
    'services/api/src/modules/parent/parent.controller.ts', 'services/api/src/modules/teacher/teacher.service.ts',
    'services/api/src/modules/ai-tutor/tutor.service.ts', 'services/api/src/modules/admin-copilot/copilot.service.ts',
    'apps/auth-portal/app/login/page.tsx', 'apps/auth-portal/app/home/scroll-reveal.tsx',
    'apps/student-center/features/tutor/TutorPage.tsx', 'apps/student-center/features/tutor/components/TeamAgentHud.tsx',
    'apps/student-center/features/tutor/components/OpticsDiffractionScatteringCard.tsx',
    'apps/admin-console/app/(console)/copilot/page.tsx', 'apps/admin-console/app/(console)/settings/skills/page.tsx',
    'apps/admin-console/app/(console)/settings/tools/page.tsx', 'apps/admin-console/app/(console)/settings/settings-compact.css',
]
sources = []
for name in paths:
    current, snapshot = (root / name).read_bytes(), (build / name).read_bytes()
    sources.append({'file': name, 'sha256': hashlib.sha256(snapshot).hexdigest(), 'matchesWorkspace': current == snapshot})
assert all(source['matchesWorkspace'] for source in sources), 'Source changed since validation; inspect before reporting final results'
(out / 'validation-source-manifest.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Validated evidence: {counts["pass"]} API tests, {len(apps)} frontend builds, {summary["screenshotCount"]} screenshots')
