/**
 * Test script for Hipages Tradiecore Lead Detection Module with OAuth-aware authentication
 * 
 * This script tests the LeadDetector class by initializing it and running it for a short period.
 * It verifies that the detector can log in using the OAuth flow, set up detection methods, and handle webhook notifications.
 */

const { LeadDetector } = require('./lead-detector');

// Configuration for testing
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
      'Content-Type': 'application/json'
    }
  },
  
  // Timing - Shorter intervals for testing
  timing: {
    pollingInterval: 2000, // 2 seconds
    baseBackoffDelay: 1000, // 1 second
    maxBackoffDelay: 10000, // 10 seconds
    pageLoadTimeout: 30000, // 30 seconds
    loginRetryDelay: 10000 // 10 seconds
  },
  
  // Cookie storage
  cookieStorage: {
    enabled: true,
    path: './test-cookies-oauth.json'
  }
};

/**
 * Run the test
 */
async function runTest() {
  console.log('Starting test of LeadDetector with OAuth-aware authentication...');
  
  // Create detector instance
  const detector = new LeadDetector(TEST_CONFIG);
  
  // Override webhook notification method for testing
  detector.sendWebhookNotification = async (data) => {
    console.log('MOCK WEBHOOK NOTIFICATION:', JSON.stringify(data, null, 2));
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
    console.log('Running detector for 30 seconds...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
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
