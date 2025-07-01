// Background script for Delivery Ops extension

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getGoogleDriveToken') {
    getGoogleDriveAccessToken()
      .then(token => {
        sendResponse({ success: true, token: token });
      })
      .catch(error => {
        console.error('Error getting Google Drive token:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  } else if (request.action === 'fetchDeliveryFolders') {
    fetchDeliveryFoldersBackground(request.batchId, request.userToken)
      .then(folders => {
        sendResponse({ success: true, folders: folders });
      })
      .catch(error => {
        console.error('Error fetching delivery folders:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  } else if (request.action === 'clearAuth') {
    clearCachedAuth()
      .then(() => {
        sendResponse({ success: true, message: 'Authentication cleared successfully' });
      })
      .catch(error => {
        console.error('Error clearing auth:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  }
});

// Get Google Drive access token using Chrome identity API
async function getGoogleDriveAccessToken() {
  return new Promise(async (resolve, reject) => {
    try {
      // First, try to get a token without user interaction
      const token = await getTokenWithValidation(false);
      if (token) {
        resolve(token);
        return;
      }
    } catch (error) {
      console.log('Cached token invalid or missing, requesting new token...');
    }
    
    // If no valid cached token, request with user interaction
    try {
      const token = await getTokenWithValidation(true);
      resolve(token);
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to get and validate token
async function getTokenWithValidation(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(
      { 
        interactive: interactive,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file'
        ]
      },
      async (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!token) {
          reject(new Error('No token received'));
          return;
        }
        
        // Validate the token by making a test API call
        try {
          const isValid = await validateToken(token);
          if (isValid) {
            resolve(token);
          } else {
            // Token is invalid, remove it from cache
            chrome.identity.removeCachedAuthToken({ token: token }, () => {
              reject(new Error('Token validation failed'));
            });
          }
        } catch (error) {
          // Token validation failed, remove it from cache
          chrome.identity.removeCachedAuthToken({ token: token }, () => {
            reject(new Error(`Token validation error: ${error.message}`));
          });
        }
      }
    );
  });
}

// Validate token by making a simple API call
async function validateToken(token) {
  try {
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('Token validation failed:', error);
    return false;
  }
}

// Clear cached authentication tokens
async function clearCachedAuth() {
  return new Promise((resolve, reject) => {
    // First, get any cached token without prompting for user interaction
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        // No cached token found, which is fine
        console.log('No cached token found:', chrome.runtime.lastError.message);
        resolve();
        return;
      }
      
      if (token) {
        // Remove the token from Chrome's cache
        chrome.identity.removeCachedAuthToken({ token: token }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          console.log('Cached auth token removed successfully');
          
          // Optionally revoke the token with Google (this logs the user out completely)
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
            method: 'POST'
          }).then(() => {
            console.log('Token revoked with Google');
            resolve();
          }).catch((error) => {
            console.warn('Failed to revoke token with Google, but cache cleared:', error);
            // Still resolve since the cache was cleared successfully
            resolve();
          });
        });
      } else {
        // No token to clear
        resolve();
      }
    });
  });
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Delivery Ops extension installed');
  } else if (details.reason === 'update') {
    console.log('Delivery Ops extension updated');
  }
});

// Handle tab updates to check if we're on the target page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const targetPattern = /https:\/\/eval\.turing\.com\/delivery\/\d+\/view\/tasks/;
    if (targetPattern.test(tab.url)) {
      console.log('Target page detected:', tab.url);
      // The content script will handle the rest
    }
  }
});

// Fetch delivery folders from background script with proper permissions
async function fetchDeliveryFoldersBackground(batchId, userToken) {
  // Step 1: Fetch delivery tasks
  const tasksUrl = `https://eval.turing.com/api/delivery/tasks?limit=1000&page=1&join[0]=task&filter[0]=deliveryBatchId||$eq||${batchId}&join[1]=task.project&join[2]=task.batch&join[3]=task.currentUser&join[4]=deliveryBatch&join[5]=task.versions`;
  
  const tasksResponse = await fetch(tasksUrl, {
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!tasksResponse.ok) {
    throw new Error(`Failed to fetch tasks: ${tasksResponse.status} ${tasksResponse.statusText}`);
  }
  
  const tasksData = await tasksResponse.json();
  
  if (!tasksData.data || !Array.isArray(tasksData.data)) {
    throw new Error('Invalid response format from tasks API');
  }
  
  // Step 2: Extract repo_id and instance_id from task statements
  const taskInfo = [];
  for (const item of tasksData.data) {
    if (item.task && item.task.statement) {
      const statement = item.task.statement;
      const parsed = parseTaskStatementBackground(statement);
      if (parsed.repo_id && parsed.instance_id) {
        taskInfo.push(parsed);
      }
    }
  }
  
  if (taskInfo.length === 0) {
    throw new Error('No valid task information found');
  }
  
  // Step 3: Fetch deliverable URLs for each task
  const deliverableFolders = [];
  for (const task of taskInfo) {
    try {
      const jobUrl = `https://swe-bench-plus.turing.com/api/jobs/get?topic=run_pipeline_msft&instance_id=${task.instance_id}&repo_id=${task.repo_id}`;
      
      const jobResponse = await fetch(jobUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Cookie': `eval_access_token=${userToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (jobResponse.ok) {
        const jobData = await jobResponse.json();
        if (jobData.result && jobData.result.deliverable_url) {
          deliverableFolders.push({
            url: jobData.result.deliverable_url,
            repo_id: task.repo_id,
            instance_id: task.instance_id
          });
        } else {
          console.warn(`No deliverable_url found for ${task.instance_id}`);
        }
      } else {
        console.warn(`Failed to fetch deliverable for ${task.instance_id}: ${jobResponse.status} ${jobResponse.statusText}`);
      }
    } catch (error) {
      console.warn(`Failed to fetch deliverable for ${task.instance_id}:`, error);
    }
  }
  
  if (deliverableFolders.length === 0) {
    throw new Error('No deliverable folders found');
  }
  
  return deliverableFolders;
}

// Parse task statement to extract repo_id and instance_id (background version)
function parseTaskStatementBackground(statement) {
  const result = {
    repo_id: null,
    instance_id: null
  };
  
  // Extract instance_id first
  const instanceIdMatch = statement.match(/\*\*instance_id\*\* - (.+)/);
  if (instanceIdMatch) {
    result.instance_id = instanceIdMatch[1].trim();
    
    // Derive repo_id from instance_id by removing the dash and what's after it
    const lastDashIndex = result.instance_id.lastIndexOf('-');
    if (lastDashIndex !== -1) {
      result.repo_id = result.instance_id.substring(0, lastDashIndex);
    } else {
      // If no dash found, use the entire instance_id as repo_id
      result.repo_id = result.instance_id;
    }
  }
  
  return result;
} 