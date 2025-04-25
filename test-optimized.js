/**
 * Test script for the optimized lead detector
 * 
 * This script runs the optimized lead detector with test configuration
 * to verify that it correctly handles change detection and deduplication.
 */

const { LeadDetector } = require('./lead-detector');

// Test configuration
const TEST_CONFIG = {
  // Authentication
  credentials: {
    email: 'info@alldirectplumbing.com.au',
    password: 'y6729WhV'
  },
  
  // URLs
  urls: {
    leads: 'https://tradiecore.hipages.com.au/leads',
    leadsData: 'https://tradiecore.hipages.com.au/leads.data?_routes=routes%2F_app%2Fleads%2F_leads'
  },
  
  // Webhook - Using a test webhook service for validation
  webhook: {
    url: 'https://n8n.fy.studio/webhook/bbf85d2c-bc64-4693-a970-8a856cd8320a',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Mode': 'true'
    }
  },
  
  // Timing - Shorter intervals for testing
  timing: {
    pollingInterval: 3000, // 3 seconds
    baseBackoffDelay: 1000, // 1 second
    maxBackoffDelay: 10000, // 10 seconds
    pageLoadTimeout: 30000, // 30 seconds
    loginRetryDelay: 10000 // 10 seconds
  },
  
  // Cookie storage
  cookieStorage: {
    enabled: true,
    path: './test-cookies.json'
  },
  
  // Change detection
  changeDetection: {
    // Fields to ignore when comparing lead data (timestamps, session tokens, etc.)
    ignoreFields: ['timestamp', 'csrf', 'session', 'time', 'date', 'updated_at', 'created_at'],
    // Only notify about actual new leads, not just any data change
    onlyNotifyNewLeads: true,
    // Minimum number of new leads required to trigger notification
    minNewLeadsToNotify: 1,
    // Deduplication window in milliseconds (to prevent duplicate notifications)
    deduplicationWindow: 5000
  }
};

/**
 * Run the test
 */
async function runTest() {
  console.log('Starting test of optimized LeadDetector...');
  
  // Create detector instance with test configuration
  const detector = new LeadDetector(TEST_CONFIG);
  
  // Override the webhook notification method to log instead of sending
  detector.sendWebhookNotification = async (data) => {
    console.log('=== WEBHOOK NOTIFICATION ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('===========================');
    return true;
  };
  
  try {
    // Initialize the detector
    console.log('Initializing detector...');
    const success = await detector.initialize();
    
    if (!success) {
      console.error('Failed to initialize detector');
      process.exit(1);
    }
    
    console.log('Detector initialized successfully');
    
    // Run for a test period
    console.log('Running detector for 60 seconds...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // Stop the detector
    console.log('Test complete, stopping detector...');
    await detector.stop();
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
    await detector.stop();
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  runTest().catch(error => {
    console.error('Unhandled error in test:', error);
    process.exit(1);
  });
}
