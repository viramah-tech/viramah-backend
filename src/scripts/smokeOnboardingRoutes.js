/*
 * Route smoke test for critical onboarding/deposit endpoints.
 * Requires backend server to be running.
 *
 * Usage:
 *   node src/scripts/smokeOnboardingRoutes.js
 *   SMOKE_API_BASE=http://localhost:5000 node src/scripts/smokeOnboardingRoutes.js
 */

const API_BASE = process.env.SMOKE_API_BASE || `http://localhost:${process.env.PORT || 5000}`;

const checks = [
  { method: 'GET', path: '/api/public/health', expect: [200] },
  { method: 'GET', path: '/api/public/rooms', expect: [200] },
  { method: 'GET', path: '/api/public/auth/me', expect: [401, 403] },
  { method: 'GET', path: '/api/public/deposits/status', expect: [401, 403] },
  { method: 'PATCH', path: '/api/public/onboarding/step-3', expect: [401, 403], body: { roomTypeId: '000000000000000000000000' } },
  { method: 'POST', path: '/api/public/onboarding/confirm', expect: [401, 403] },
  { method: 'GET', path: '/api/v1/bookings/my-booking', expect: [401, 403] },
  { method: 'POST', path: '/api/v1/bookings', expect: [401, 403], body: { roomTypeId: '000000000000000000000000' } },
];

async function run() {
  const failures = [];

  for (const check of checks) {
    const url = `${API_BASE}${check.path}`;
    try {
      const res = await fetch(url, {
        method: check.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: check.body ? JSON.stringify(check.body) : undefined,
      });

      const statusOk = check.expect.includes(res.status);
      const notFound = res.status === 404;

      if (!statusOk || notFound) {
        failures.push({
          method: check.method,
          path: check.path,
          status: res.status,
          expected: check.expect,
        });
      }

      console.log(`${check.method.padEnd(6)} ${check.path.padEnd(40)} -> ${res.status}`);
    } catch (err) {
      failures.push({
        method: check.method,
        path: check.path,
        status: 'NETWORK_ERROR',
        expected: check.expect,
        message: err instanceof Error ? err.message : String(err),
      });
      console.log(`${check.method.padEnd(6)} ${check.path.padEnd(40)} -> NETWORK_ERROR`);
    }
  }

  if (failures.length) {
    console.error('\nSmoke checks failed:');
    for (const failure of failures) {
      console.error(`- ${failure.method} ${failure.path}: got ${failure.status}, expected ${failure.expected.join('/')}`);
      if (failure.message) {
        console.error(`  ${failure.message}`);
      }
    }
    process.exit(1);
  }

  console.log('\nAll onboarding route smoke checks passed.');
}

run();
