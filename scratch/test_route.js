const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const API_BASE = 'http://localhost:5000/api/v1';

async function testEndpoint() {
  try {
    // Note: We need a valid token. Since this is local dev, we might need a test user.
    // However, I can check if the route is at least registered by calling it without auth
    // and expecting a 401/403 instead of a 404.
    const url = `${API_BASE}/bookings/66d8bfadff31e3e6aad0f1ef`; // dummy id
    console.log(`Testing GET ${url}...`);
    
    const res = await axios.get(url, { validateStatus: false });
    console.log(`Status: ${res.status}`);
    console.log(`Data:`, res.data);

    if (res.status === 401 || res.status === 403) {
      console.log('SUCCESS: Route is registered and protected (Returned 401/403).');
    } else if (res.status === 404) {
      console.log('FAILURE: Route still returns 404.');
    } else {
      console.log(`Unexpected status: ${res.status}`);
    }
  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

testEndpoint();
