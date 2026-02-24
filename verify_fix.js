
const axios = require('axios');

const API_BASE = 'http://localhost:4000/api';

async function test() {
    try {
        console.log('1. Triggering scrape...');
        const res = await axios.post(`${API_BASE}/pricing/scrape`, {
            from_port: 'Singapore',
            to_port: 'Jebel Ali',
            container_type: '40FT',
            use_live_scraper: false // use simulation for speed
        });

        console.log('Response:', res.data);
        const jobId = res.data.job_id;

        if (res.data.status === 'STARTED') {
            console.log('2. Polling for results (Job ID:', jobId, ')...');
            let status = 'RUNNING';
            let job;
            while (status === 'RUNNING') {
                process.stdout.write('.');
                const poll = await axios.get(`${API_BASE}/pricing/jobs/${jobId}`);
                job = poll.data;
                status = job.status;
                await new Promise(r => setTimeout(r, 1000));
            }
            console.log('\nFinal Job Status:', status);
            console.log('Found', (job.candidates || []).length, 'candidates');
        }
    } catch (err) {
        console.error('Test Failed:', err.message);
        if (err.response) console.error('Error Data:', err.response.data);
    }
}

test();
