/**
 * Hipages Tradiecore Lead Detection Module
 * 
 * This script monitors the Hipages Tradiecore leads page for new leads and sends
 * webhook notifications when changes are detected. It uses two complementary methods:
 * 1. DOM Mutation Observer - Detects changes to the page structure
 * 2. Polling Fallback - Periodically checks the leads.data endpoint
 * 
 * Features:
 * - Sub-second response time for new lead detection
 * - Webhook notifications to specified endpoint
 * - Cookie support for authentication persistence
 * - Exponential backoff for error handling
 * - Auto-relogin capability
 * - OAuth-aware authentication flow
 * - Smart change detection to prevent false positives
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  // Authentication
  credentials: {
    email: process.env.HIPAGES_EMAIL,
    password: process.env.HIPAGES_PASSWORD
  },
  
  // URLs
  urls: {
    leads: 'https://tradiecore.hipages.com.au/leads',
    leadsData: 'https://tradiecore.hipages.com.au/leads.data?_routes=routes%2F_app%2Fleads%2F_leads'
  },
  
  // Webhook
  webhook: {
    url: 'https://n8n.fy.studio/webhook/bbf85d2c-bc64-4693-a970-8a856cd8320a',
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

if (!process.env.HIPAGES_EMAIL || !process.env.HIPAGES_PASSWORD) {
  throw new Error('Missing HIPAGES_EMAIL or HIPAGES_PASSWORD in environment variables.');
}

/**
 * Main class for lead detection
 */
class LeadDetector {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.previousLeadsData = null;
    this.previousLeadsArray = null;
    this.retryCount = 0;
    this.loginRetryCount = 0;
    this.cookies = null;
    this.isRunning = false;
    this.cookieStoragePath = path.resolve(process.cwd(), this.config.cookieStorage.path);
    this.lastNotificationTime = 0;
    this.lastNotifiedLeadIds = new Set();
  }
  
  /**
   * Initialize the detector
   */
  async initialize() {
    try {
      console.log('Initializing lead detector...');
      
      // Launch browser
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      // Create new page
      this.page = await this.browser.newPage();
      
      // Set viewport
      await this.page.setViewport({ width: 1280, height: 800 });
      
      // Try to load cookies from storage
      const loadedCookies = await this.loadCookiesFromStorage();
      
      if (loadedCookies && loadedCookies.length > 0) {
        console.log('Loaded cookies from storage, attempting to use existing session...');
        await this.page.setCookie(...loadedCookies);
        this.cookies = loadedCookies;
        
        // Try to access leads page directly
        const sessionValid = await this.validateSession();
        
        if (sessionValid) {
          console.log('Existing session is valid, skipping login');
          // Start detection methods
          await this.startDetection();
          console.log('Lead detector initialized successfully with existing session');
          return true;
        } else {
          console.log('Existing session is invalid, proceeding with login');
        }
      }
      
      // Login using OAuth flow
      const loginSuccess = await this.loginWithOAuth();
      
      if (!loginSuccess) {
        console.error('Login failed');
        return false;
      }
      
      // Start detection methods
      await this.startDetection();
      
      console.log('Lead detector initialized successfully');
      return true;
    } catch (error) {
      console.error('Error initializing lead detector:', error);
      await this.cleanup();
      return false;
    }
  }
  
  /**
   * Validate if the current session is still valid
   */
  async validateSession() {
    try {
      console.log('Validating session...');
      
      // Navigate to leads page
      await this.page.goto(this.config.urls.leads, { 
        waitUntil: 'networkidle2',
        timeout: this.config.timing.pageLoadTimeout
      });
      
      // Check if we're on the leads page
      const currentUrl = this.page.url();
      const isLeadsPage = currentUrl.includes('/leads') && !currentUrl.includes('/login');
      
      if (isLeadsPage) {
        console.log('Session is valid, already on leads page');
        return true;
      }
      
      // Check if we're on the login page
      const isLoginPage = currentUrl.includes('/login');
      
      if (isLoginPage) {
        console.log('Session is invalid, redirected to login page');
        return false;
      }
      
      console.log('Session validation inconclusive, current URL:', currentUrl);
      return false;
    } catch (error) {
      console.error('Error validating session:', error);
      return false;
    }
  }
  
  /**
   * Login using OAuth flow
   */
  async loginWithOAuth() {
    try {
      console.log('Starting OAuth login flow...');
      
      // First navigate to the leads page to trigger the OAuth redirect
      await this.page.goto(this.config.urls.leads, { 
        waitUntil: 'networkidle2',
        timeout: this.config.timing.pageLoadTimeout
      });
      
      // Check if we're already logged in
      const currentUrl = this.page.url();
      if (currentUrl.includes('/leads') && !currentUrl.includes('/login')) {
        console.log('Already logged in, skipping login process');
        
        // Store cookies for API requests
        this.cookies = await this.page.cookies();
        
        // Save cookies to storage
        if (this.config.cookieStorage.enabled) {
          await this.saveCookiesToStorage(this.cookies);
        }
        
        return true;
      }
      
      // We should now be on the login page with all the OAuth parameters
      console.log('Redirected to login page, checking URL...');
      
      // Verify we're on the login page with OAuth parameters
      if (!currentUrl.includes('auth.hipages.com.au/login') || 
          !currentUrl.includes('state=') || 
          !currentUrl.includes('redirect_uri=')) {
        console.error('Not redirected to proper OAuth login page, current URL:', currentUrl);
        return false;
      }
      
      console.log('On OAuth login page, proceeding with login...');
      
      // Wait for email input field
      try {
        await this.page.waitForSelector('input[type="email"], input[placeholder*="Email"], input[name="email"], input[id*="email"]', { 
          timeout: 5000 
        });
      } catch (error) {
        console.error('Email input field not found on login page');
        return false;
      }
      
      // Enter email - try different selectors
      try {
        await this.page.type('input[type="email"], input[placeholder*="Email"], input[name="email"], input[id*="email"]', 
          this.config.credentials.email
        );
      } catch (error) {
        console.error('Failed to enter email:', error);
        return false;
      }
      
      // Wait for password input field
      try {
        await this.page.waitForSelector('input[type="password"], input[placeholder*="Password"], input[name="password"], input[id*="password"]', { 
          timeout: 5000 
        });
      } catch (error) {
        console.error('Password input field not found on login page');
        return false;
      }
      
      // Enter password - try different selectors
      try {
        await this.page.type('input[type="password"], input[placeholder*="Password"], input[name="password"], input[id*="password"]', 
          this.config.credentials.password
        );
      } catch (error) {
        console.error('Failed to enter password:', error);
        return false;
      }
      
      // Find and click login button
      try {
        // Try to find button by type or text content
        const loginButtonSelector = 'button[type="submit"]';
        
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
          this.page.click(loginButtonSelector)
        ]);
      } catch (error) {
        console.error('Error clicking login button:', error);
        
        // Try alternative approach - evaluate in page context
        try {
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            this.page.evaluate(() => {
              const loginButtons = Array.from(document.querySelectorAll('button')).filter(button => {
                const text = button.textContent.toLowerCase();
                return text.includes('log in') || text.includes('login') || text.includes('sign in');
              });
              
              if (loginButtons.length > 0) {
                loginButtons[0].click();
                return true;
              }
              return false;
            })
          ]);
        } catch (altError) {
          console.error('Alternative login button click also failed:', altError);
          return false;
        }
      }
      
      // Check if login was successful
      const postLoginUrl = this.page.url();
      if (!postLoginUrl.includes('tradiecore.hipages.com.au')) {
        console.log('Login failed, redirected to:', postLoginUrl);
        return false;
      }
      
      // Store cookies for API requests
      this.cookies = await this.page.cookies();
      
      // Save cookies to storage
      if (this.config.cookieStorage.enabled) {
        await this.saveCookiesToStorage(this.cookies);
      }
      
      console.log('Login successful');
      return true;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  }
  
  /**
   * Save cookies to storage
   */
  async saveCookiesToStorage(cookies) {
    try {
      fs.writeFileSync(this.cookieStoragePath, JSON.stringify(cookies, null, 2));
      console.log('Cookies saved to storage');
      return true;
    } catch (error) {
      console.error('Error saving cookies to storage:', error);
      return false;
    }
  }
  
  /**
   * Load cookies from storage
   */
  async loadCookiesFromStorage() {
    try {
      if (fs.existsSync(this.cookieStoragePath)) {
        const cookiesJson = fs.readFileSync(this.cookieStoragePath, 'utf8');
        const cookies = JSON.parse(cookiesJson);
        console.log('Cookies loaded from storage');
        return cookies;
      }
    } catch (error) {
      console.error('Error loading cookies from storage:', error);
    }
    
    return null;
  }
  
  /**
   * Start both detection methods
   */
  async startDetection() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Navigate to leads page
    await this.page.goto(this.config.urls.leads, { 
      waitUntil: 'networkidle2',
      timeout: this.config.timing.pageLoadTimeout
    });
    
    // Start DOM mutation observer
    await this.startDomMutationObserver();
    
    // Start polling fallback
    this.startPollingFallback();
    
    console.log('Lead detection started');
  }
  
  /**
   * Inject and start DOM mutation observer
   */
  async startDomMutationObserver() {
    console.log('Starting DOM mutation observer...');
    
    // Inject the mutation observer script
    await this.page.evaluate(() => {
      // Find the lead container
      function findLeadContainer() {
        const potentialContainers = [
          document.querySelector('main'),
          document.querySelector('[class*="lead-list"]'),
          document.querySelector('[class*="leads-list"]'),
          document.querySelector('[data-testid*="lead"]')?.parentElement,
          Array.from(document.querySelectorAll('[class*="lead"]')).find(el => 
            el.parentElement?.querySelectorAll('[class*="lead"]').length > 1
          )?.parentElement
        ].filter(Boolean);
        
        if (potentialContainers.length > 0) {
          return potentialContainers[0];
        }
        
        return document.querySelector('main') || document.body;
      }
      
      // Function to extract lead data from a DOM element
      function extractLeadData(element) {
        const leadId = element.id || 
                      element.getAttribute('data-id') || 
                      element.getAttribute('data-lead-id') ||
                      element.querySelector('[data-id]')?.getAttribute('data-id');
        
        const nameElement = element.querySelector('h2, h3, [class*="name"], [class*="title"]');
        const leadName = nameElement ? nameElement.textContent.trim() : '';
        
        const timeElement = element.querySelector('[class*="time"], [class*="date"], time');
        const timestamp = timeElement ? timeElement.textContent.trim() : '';
        
        const locationElement = element.querySelector('[class*="location"], [class*="address"]');
        const location = locationElement ? locationElement.textContent.trim() : '';
        
        const jobTypeElement = element.querySelector('[class*="job"], [class*="type"], [class*="category"]');
        const jobType = jobTypeElement ? jobTypeElement.textContent.trim() : '';
        
        return {
          id: leadId,
          name: leadName,
          timestamp,
          location,
          jobType,
          html: element.outerHTML.substring(0, 500)
        };
      }
      
      // Function to get all current leads
      function getCurrentLeads() {
        const leadElements = document.querySelectorAll('[class*="lead"], [id*="lead"], [data-testid*="lead"]');
        console.log(`Found ${leadElements.length} potential lead elements`);
        
        const leads = Array.from(leadElements).map(extractLeadData);
        return leads;
      }
      
      // Get the initial set of leads
      const initialLeads = getCurrentLeads();
      console.log('Initial leads count:', initialLeads.length);
      
      // Store the initial leads for comparison
      window.previousLeads = initialLeads;
      
      // Function to compare leads and detect new ones
      function detectNewLeads(currentLeads) {
        if (!window.previousLeads) return [];
        
        // Find leads that are in currentLeads but not in previousLeads
        const newLeads = currentLeads.filter(currentLead => {
          // If the lead has an ID, use that for comparison
          if (currentLead.id) {
            return !window.previousLeads.some(prevLead => prevLead.id === currentLead.id);
          }
          
          // Otherwise, compare based on name and other properties
          return !window.previousLeads.some(prevLead => 
            prevLead.name === currentLead.name && 
            prevLead.location === currentLead.location &&
            prevLead.jobType === currentLead.jobType
          );
        });
        
        return newLeads;
      }
      
      // Function to notify about new leads
      function notifyNewLeads(newLeads) {
        // This function will be overridden by the main script to send webhook notifications
        // We're just dispatching a custom event that will be listened for
        const event = new CustomEvent('newLeadsDetected', { detail: newLeads });
        document.dispatchEvent(event);
      }
      
      // Create and configure the mutation observer
      const leadContainer = findLeadContainer();
      console.log('Selected lead container:', leadContainer);
      
      const observer = new MutationObserver((mutations) => {
        console.log('DOM mutations detected:', mutations.length);
        
        // Check if any of the mutations involve adding nodes
        const hasAddedNodes = mutations.some(mutation => 
          mutation.type === 'childList' && mutation.addedNodes.length > 0
        );
        
        if (hasAddedNodes) {
          console.log('Nodes added to the DOM, checking for new leads...');
          
          // Get the current set of leads
          const currentLeads = getCurrentLeads();
          
          // Detect new leads
          const newLeads = detectNewLeads(currentLeads);
          
          if (newLeads.length > 0) {
            console.log('New leads detected:', newLeads);
            
            // Update the stored leads
            window.previousLeads = currentLeads;
            
            // Notify about new leads
            notifyNewLeads(newLeads);
          } else {
            console.log('No new leads detected');
          }
        }
      });
      
      // Start observing the lead container
      observer.observe(leadContainer, {
        childList: true,  // Watch for changes to the direct children
        subtree: true,    // Watch for changes to the entire subtree
        attributes: false, // Don't watch for changes to attributes
        characterData: false // Don't watch for changes to text content
      });
      
      console.log('DOM mutation observer started');
    });
    
    // Listen for the custom event from the page
    await this.page.exposeFunction('sendWebhookNotification', async (newLeads) => {
      // Check if we should deduplicate this notification
      if (this.shouldSendNotification(newLeads.map(lead => lead.id || lead.name))) {
        await this.sendWebhookNotification({
          event: 'new_leads_detected',
          method: 'dom_mutation',
          leads: newLeads,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('Skipping duplicate notification for DOM mutation');
      }
    });
    
    // Set up the event listener
    await this.page.evaluate(() => {
      document.addEventListener('newLeadsDetected', (event) => {
        window.sendWebhookNotification(event.detail);
      });
    });
    
    console.log('DOM mutation observer initialized');
  }
  
  /**
   * Start polling fallback mechanism
   */
  startPollingFallback() {
    console.log('Starting polling fallback...');
    this.pollLeadsData();
  }
  
  /**
   * Poll the leads.data endpoint for changes
   */
  async pollLeadsData() {
    if (!this.isRunning) return;
    
    try {
      console.log(`Polling leads data (attempt ${this.retryCount + 1})...`);
      
      // Fetch the leads data
      const leadsData = await this.fetchLeadsData();
      
      if (!leadsData) {
        // Handle error case
        this.retryCount++;
        const backoffDelay = this.getBackoffDelay(this.retryCount);
        console.log(`Error fetching leads data, retrying in ${backoffDelay}ms...`);
        setTimeout(() => this.pollLeadsData(), backoffDelay);
        return;
      }
      
      // Parse the leads data
      let currentLeadsArray = null;
      try {
        currentLeadsArray = JSON.parse(leadsData);
      } catch (e) {
        console.log('Response is not valid JSON, using raw data for comparison');
      }
      
      // If this is the first poll, just store the data
      if (this.previousLeadsData === null) {
        console.log('Initial leads data stored');
        this.previousLeadsData = leadsData;
        this.previousLeadsArray = currentLeadsArray;
        setTimeout(() => this.pollLeadsData(), this.config.timing.pollingInterval);
        return;
      }
      
      // Compare with previous data to detect changes
      const { hasChanges, newLeads } = this.detectLeadChanges(
        this.previousLeadsData, 
        leadsData, 
        this.previousLeadsArray, 
        currentLeadsArray
      );
      
      if (hasChanges && newLeads.length >= this.config.changeDetection.minNewLeadsToNotify) {
        console.log(`Changes detected in leads data: ${newLeads.length} new leads`);
        
        // Check if we should deduplicate this notification
        if (this.shouldSendNotification(newLeads.map(lead => lead.id || lead.uniqueKey))) {
          // Send webhook notification
          await this.sendWebhookNotification({
            event: 'new_leads_detected',
            method: 'polling',
            leads: newLeads,
            timestamp: new Date().toISOString()
          });
        } else {
          console.log('Skipping duplicate notification for polling');
        }
        
        // Update the previous data
        this.previousLeadsData = leadsData;
        this.previousLeadsArray = currentLeadsArray;
      } else if (hasChanges) {
        console.log('Minor changes detected in leads data, but no new leads');
        // Update the previous data to prevent future false positives
        this.previousLeadsData = leadsData;
        this.previousLeadsArray = currentLeadsArray;
      } else {
        console.log('No changes detected in leads data');
      }
      
      // Reset retry count on successful poll
      this.retryCount = 0;
      
      // Schedule the next poll
      setTimeout(() => this.pollLeadsData(), this.config.timing.pollingInterval);
    } catch (error) {
      console.error('Error in polling function:', error);
      
      // Implement exponential backoff
      this.retryCount++;
      const backoffDelay = this.getBackoffDelay(this.retryCount);
      console.log(`Error in polling function, retrying in ${backoffDelay}ms...`);
      setTimeout(() => this.pollLeadsData(), backoffDelay);
    }
  }
  
  /**
   * Check if we should send a notification (deduplication)
   */
  shouldSendNotification(leadIds) {
    const now = Date.now();
    
    // Check if we're within the deduplication window
    if (now - this.lastNotificationTime < this.config.changeDetection.deduplicationWindow) {
      // Check if any of the lead IDs were already notified
      const hasOverlap = leadIds.some(id => this.lastNotifiedLeadIds.has(id));
      if (hasOverlap) {
        return false;
      }
    } else {
      // Outside the window, clear the previous lead IDs
      this.lastNotifiedLeadIds.clear();
    }
    
    // Update the last notification time and lead IDs
    this.lastNotificationTime = now;
    leadIds.forEach(id => this.lastNotifiedLeadIds.add(id));
    
    return true;
  }
  
  /**
   * Fetch leads data from the API
   */
  async fetchLeadsData() {
    try {
      // Prepare cookies for the request
      const cookieString = this.cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');
      
      // Make the request using Node.js https module
      return new Promise((resolve, reject) => {
        const url = new URL(this.config.urls.leadsData);
        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Cookie': cookieString
          }
        };
        
        const req = https.request(options, (res) => {
          // Check if we need to re-login
          if (res.statusCode === 401 || res.statusCode === 403 || 
              res.headers.location && res.headers.location.includes('/login')) {
            this.handleRelogin();
            resolve(null);
            return;
          }
          
          // Check if the request was successful
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP error: ${res.statusCode}`));
            return;
          }
          
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            resolve(data);
          });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.end();
      });
    } catch (error) {
      console.error('Error fetching leads data:', error);
      return null;
    }
  }
  
  /**
   * Compare leads data and detect changes
   */
  detectLeadChanges(previousData, currentData, previousArray, currentArray) {
    // If we have parsed arrays, use them for smarter comparison
    if (Array.isArray(previousArray) && Array.isArray(currentArray)) {
      return this.detectLeadChangesFromArrays(previousArray, currentArray);
    }
    
    // Fallback to string comparison with regex filtering
    return this.detectLeadChangesFromStrings(previousData, currentData);
  }
  
  /**
   * Detect lead changes from parsed arrays
   */
  detectLeadChangesFromArrays(previousArray, currentArray) {
    // Extract lead objects from the arrays
    const previousLeads = this.extractLeadObjects(previousArray);
    const currentLeads = this.extractLeadObjects(currentArray);
    
    // Find new leads by comparing IDs or unique keys
    const newLeads = currentLeads.filter(currentLead => {
      return !previousLeads.some(prevLead => 
        this.areLeadsEqual(prevLead, currentLead)
      );
    });
    
    return {
      hasChanges: newLeads.length > 0,
      newLeads
    };
  }
  
  /**
   * Extract lead objects from array data
   */
  extractLeadObjects(array) {
    // If the array contains lead objects directly
    if (array.length > 0 && typeof array[0] === 'object' && array[0] !== null) {
      return array.map(item => {
        // Create a unique key for comparison if ID is missing
        if (!item.id) {
          const uniqueKey = this.createUniqueKey(item);
          return { ...item, uniqueKey };
        }
        return item;
      });
    }
    
    // If it's a nested structure, try to find lead objects
    const leads = [];
    const processItem = (item) => {
      if (item && typeof item === 'object') {
        // Check if this looks like a lead object
        if (this.isLikelyLeadObject(item)) {
          // Create a unique key for comparison if ID is missing
          if (!item.id) {
            const uniqueKey = this.createUniqueKey(item);
            leads.push({ ...item, uniqueKey });
          } else {
            leads.push(item);
          }
        }
        
        // Recursively process arrays and objects
        if (Array.isArray(item)) {
          item.forEach(processItem);
        } else {
          Object.values(item).forEach(val => {
            if (val && typeof val === 'object') {
              processItem(val);
            }
          });
        }
      }
    };
    
    processItem(array);
    return leads;
  }
  
  /**
   * Check if an object is likely a lead object
   */
  isLikelyLeadObject(obj) {
    // Check for common lead properties
    const leadProperties = ['id', 'name', 'title', 'description', 'location', 'address', 'job', 'type', 'category'];
    const hasLeadProperties = leadProperties.some(prop => obj.hasOwnProperty(prop));
    
    // Check for lead-like property names
    const objKeys = Object.keys(obj);
    const hasLeadLikeKeys = objKeys.some(key => 
      key.includes('lead') || 
      key.includes('job') || 
      key.includes('customer') || 
      key.includes('client')
    );
    
    return hasLeadProperties || hasLeadLikeKeys;
  }
  
  /**
   * Create a unique key for a lead object
   */
  createUniqueKey(lead) {
    // Combine multiple properties to create a unique key
    const keyParts = [];
    
    if (lead.name) keyParts.push(lead.name);
    if (lead.title) keyParts.push(lead.title);
    if (lead.location) keyParts.push(lead.location);
    if (lead.address) keyParts.push(lead.address);
    if (lead.job) keyParts.push(lead.job);
    if (lead.type) keyParts.push(lead.type);
    if (lead.category) keyParts.push(lead.category);
    
    return keyParts.join('|');
  }
  
  /**
   * Check if two leads are equal (ignoring dynamic fields)
   */
  areLeadsEqual(lead1, lead2) {
    // If both have IDs, compare them
    if (lead1.id && lead2.id) {
      return lead1.id === lead2.id;
    }
    
    // If both have unique keys, compare them
    if (lead1.uniqueKey && lead2.uniqueKey) {
      return lead1.uniqueKey === lead2.uniqueKey;
    }
    
    // Otherwise, compare relevant fields
    const fieldsToCompare = ['name', 'title', 'location', 'address', 'job', 'type', 'category'];
    
    return fieldsToCompare.every(field => {
      // Skip fields that don't exist in both leads
      if (!lead1.hasOwnProperty(field) || !lead2.hasOwnProperty(field)) {
        return true;
      }
      
      // Compare field values
      return lead1[field] === lead2[field];
    });
  }
  
  /**
   * Detect lead changes from string data
   */
  detectLeadChangesFromStrings(previousData, currentData) {
    // Remove dynamic content that changes on every request
    const cleanPrevData = this.removeDynamicContent(previousData);
    const cleanCurrData = this.removeDynamicContent(currentData);
    
    // Check if there are still changes after removing dynamic content
    const hasChanges = cleanPrevData !== cleanCurrData;
    
    // Extract lead IDs or other identifiers
    const prevLeadIds = this.extractLeadIdentifiers(previousData);
    const currLeadIds = this.extractLeadIdentifiers(currentData);
    
    // Find new lead IDs
    const newLeadIds = currLeadIds.filter(id => !prevLeadIds.includes(id));
    
    // Create lead objects for new leads
    const newLeads = newLeadIds.map(id => ({
      id,
      detectedAt: new Date().toISOString()
    }));
    
    return {
      hasChanges: hasChanges && newLeads.length > 0,
      newLeads
    };
  }
  
  /**
   * Remove dynamic content from string data
   */
  removeDynamicContent(data) {
    let cleanData = data;
    
    // Remove timestamps
    cleanData = cleanData.replace(/\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP');
    
    // Remove date strings
    cleanData = cleanData.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, 'DATE');
    cleanData = cleanData.replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');
    
    // Remove CSRF tokens
    cleanData = cleanData.replace(/csrf[^"']+["'][^"']+["']/gi, 'CSRF_TOKEN');
    
    // Remove session IDs
    cleanData = cleanData.replace(/session[^"']+["'][^"']+["']/gi, 'SESSION_ID');
    
    return cleanData;
  }
  
  /**
   * Extract lead identifiers from string data
   */
  extractLeadIdentifiers(data) {
    // Extract lead IDs
    const leadIdRegex = /lead-\w+/g;
    const leadIds = data.match(leadIdRegex) || [];
    
    return leadIds;
  }
  
  /**
   * Send webhook notification
   */
  async sendWebhookNotification(data) {
    try {
      console.log('Sending webhook notification...');
      
      // Make the request using Node.js https module
      return new Promise((resolve, reject) => {
        const url = new URL(this.config.webhook.url);
        const postData = JSON.stringify(data);
        
        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            ...this.config.webhook.headers,
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        
        const req = protocol.request(options, (res) => {
          console.log('Webhook notification sent:', res.statusCode);
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
        
        req.on('error', (error) => {
          console.error('Error sending webhook notification:', error);
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
    } catch (error) {
      console.error('Error sending webhook notification:', error);
      return false;
    }
  }
  
  /**
   * Check if we need to re-login
   */
  checkNeedsRelogin(response) {
    return response.url && response.url.includes('/login') || response.status === 401 || response.status === 403;
  }
  
  /**
   * Handle re-login if needed
   */
  async handleRelogin() {
    console.log('Session expired, attempting to re-login...');
    
    // Increment login retry count
    this.loginRetryCount++;
    
    // If we've tried too many times, wait longer before trying again
    if (this.loginRetryCount > 3) {
      console.log(`Login retry count exceeded (${this.loginRetryCount}), waiting longer before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, this.config.timing.loginRetryDelay));
    }
    
    try {
      // Close existing page
      await this.page.close();
      
      // Create new page
      this.page = await this.browser.newPage();
      
      // Set viewport
      await this.page.setViewport({ width: 1280, height: 800 });
      
      // Login using OAuth flow
      const loginSuccess = await this.loginWithOAuth();
      
      if (!loginSuccess) {
        console.error('Re-login failed');
        return false;
      }
      
      // Navigate back to leads page
      await this.page.goto(this.config.urls.leads, { 
        waitUntil: 'networkidle2',
        timeout: this.config.timing.pageLoadTimeout
      });
      
      // Restart DOM mutation observer
      await this.startDomMutationObserver();
      
      console.log('Re-login successful');
      return true;
    } catch (error) {
      console.error('Re-login error:', error);
      return false;
    }
  }
  
  /**
   * Calculate backoff delay for retries
   */
  getBackoffDelay(retryCount) {
    const delay = Math.min(
      this.config.timing.baseBackoffDelay * Math.pow(2, retryCount),
      this.config.timing.maxBackoffDelay
    );
    // Add some jitter to avoid thundering herd problem
    return delay + Math.random() * 1000;
  }
  
  /**
   * Stop the detector
   */
  async stop() {
    console.log('Stopping lead detector...');
    this.isRunning = false;
    await this.cleanup();
    console.log('Lead detector stopped');
  }
  
  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

/**
 * Main function to start the lead detector
 */
async function main() {
  const detector = new LeadDetector(CONFIG);
  
  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    await detector.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    await detector.stop();
    process.exit(0);
  });
  
  // Initialize and start the detector
  const success = await detector.initialize();
  
  if (!success) {
    console.error('Failed to initialize lead detector');
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { LeadDetector };
