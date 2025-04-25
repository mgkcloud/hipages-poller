# Hipages Tradiecore Lead Detection Module (OAuth-Aware Version)

This module monitors the Hipages Tradiecore leads page for new leads and sends webhook notifications when changes are detected. It uses two complementary methods to ensure reliable detection:

1. **DOM Mutation Observer** - Detects changes to the page structure in real-time
2. **Polling Fallback** - Periodically checks the leads.data endpoint as a backup

## Updates in this Version

This version implements a proper OAuth-aware authentication flow:

- **OAuth-Aware Authentication** - Starts at the leads page to trigger the proper OAuth redirect with all required state parameters
- **Improved Login Selectors** - Uses more flexible selectors to find login form elements
- **Enhanced Error Handling** - Better handling of authentication errors and retries
- **Cookie Storage** - Persists authentication between sessions
- **Session Validation** - Validates existing sessions before attempting login

## Features

- Sub-second response time for new lead detection
- Webhook notifications to your specified endpoint
- Cookie support for authentication persistence
- Exponential backoff for error handling
- Auto-relogin capability when session expires
- Dockerized for easy deployment

## Requirements

- Node.js 20+
- Docker (for containerized deployment)

## Installation

### Local Development

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Run the detector:
   ```
   node lead-detector.js
   ```

### Docker Deployment

1. Build the Docker image:
   ```
   docker build -t hipages-lead-detector -f Dockerfile-oauth .
   ```
2. Run the container:
   ```
   docker run -d --name lead-detector hipages-lead-detector
   ```

## Configuration

The configuration is stored in the `CONFIG` object at the top of the `lead-detector.js` file:

```javascript
const CONFIG = {
  // Authentication
  credentials: {
    email: 'REPLACEME',
    password: 'REPLACEME'
  },
  
  // URLs
  urls: {
    leads: 'https://tradiecore.hipages.com.au/leads',
    leadsData: 'https://tradiecore.hipages.com.au/leads.data?_routes=routes%2F_app%2Fleads%2F_leads'
  },
  
  // Webhook
  webhook: {
    url: 'https://n8n.fy.studio/webhook/bbf85...',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  
  // Timing
  timing: {
    pollingInterval: 1000, // 1 second
    baseBackoffDelay: 1000, // 1 second
    maxBackoffDelay: 30000, // 30 seconds
    pageLoadTimeout: 30000, // 30 seconds
    loginRetryDelay: 60000 // 1 minute
  },
  
  // Cookie storage
  cookieStorage: {
    enabled: true,
    path: './cookies.json'
  }
};
```

You can modify these settings to customize the behavior of the detector.

## How It Works

### OAuth Authentication Flow

The module uses a proper OAuth-aware authentication approach:

1. First navigates to the leads page, which triggers a redirect to the login page with all necessary OAuth parameters
2. Handles the login form with flexible selectors to accommodate page changes
3. After successful login, stores cookies for session persistence
4. On subsequent runs, tries to use stored cookies before initiating a new login flow

### DOM Mutation Observer

The DOM Mutation Observer watches for changes to the page structure in real-time. When new lead elements are added to the DOM, it extracts the lead data and sends a webhook notification.

### Polling Fallback

The Polling Fallback mechanism periodically checks the leads.data endpoint for changes. If the response differs from the previous one, it sends a webhook notification. This ensures that leads are detected even if the DOM mutation observer fails or if the page is statically regenerated.

### Webhook Notifications

When a new lead is detected, the module sends a POST request to the configured webhook URL with the following payload:

```json
{
  "event": "new_leads_detected",
  "method": "dom_mutation",
  "leads": [
    {
      "id": "lead-id",
      "name": "Customer Name",
      "timestamp": "25th Apr 2025 - 2:01 am",
      "location": "Suburb, Postcode",
      "jobType": "Job Type"
    }
  ],
  "timestamp": "2025-04-25T02:39:56.000Z"
}
```

## Testing

To test the solution before deploying to production, use the included test script:

```
node test-script-oauth.js
```

This will:
1. Initialize the detector with test configuration
2. Override the webhook notification method to log notifications instead of sending them
3. Run the detector for 30 seconds to verify functionality
4. Gracefully stop the detector when testing is complete

## Troubleshooting

### Common Issues

- **Authentication Failures**: The module now handles the OAuth flow correctly by starting at the leads page to get the proper state parameters.
- **Webhook Errors**: Verify that the webhook URL is accessible and correctly configured.
- **Browser Launch Failures**: Ensure that all Puppeteer dependencies are installed.

### Logs

The module logs detailed information about its operation to the console. Check these logs for troubleshooting.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

# Environment Variables

This project requires the following environment variables to be set in a `.env` file in the project root:

```
HIPAGES_EMAIL=your-email@example.com
HIPAGES_PASSWORD=your-password
```

Replace the values with your actual Hipages Tradiecore credentials. The `.env` file is ignored by git for security.
