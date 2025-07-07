// Background script for Delivery Ops extension

// Job queue system for managing copy operations
class CopyJobManager {
  constructor() {
    this.activeJobs = new Map();
    this.jobIdCounter = 0;
  }

  createJob(batchId, folders, driveToken) {
    const jobId = ++this.jobIdCounter;
    const job = {
      id: jobId,
      batchId: batchId,
      folders: folders,
      driveToken: driveToken,
      status: 'created',
      progress: 0,
      completedFolders: 0,
      totalFolders: folders.length,
      errors: [],
      startTime: Date.now()
    };
    
    this.activeJobs.set(jobId, job);
    return job;
  }

  getJob(jobId) {
    return this.activeJobs.get(jobId);
  }

  updateJob(jobId, updates) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
    }
    return job;
  }

  deleteJob(jobId) {
    this.activeJobs.delete(jobId);
  }
}

const copyJobManager = new CopyJobManager();

// Enhanced DriveAPI for background operations
class BackgroundDriveAPI {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    this.maxConcurrency = 5; // Limit concurrent operations to avoid rate limits
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  // Parallel batch copy with concurrency control
  async copyMultipleFoldersParallel(sourceFolderIds, destinationFolderId, progressCallback = null) {
    const results = {
      totalFolders: sourceFolderIds.length,
      completedFolders: 0,
      totalFiles: 0,
      totalSubfolders: 0,
      errors: [],
      folderResults: []
    };

    if (progressCallback) {
      progressCallback(`🚀 Starting parallel copy of ${sourceFolderIds.length} folders with ${this.maxConcurrency} concurrent operations...`);
    }

    // Process folders in batches to control concurrency
    const batches = [];
    for (let i = 0; i < sourceFolderIds.length; i += this.maxConcurrency) {
      batches.push(sourceFolderIds.slice(i, i + this.maxConcurrency));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (folderId, index) => {
        const globalIndex = batches.indexOf(batch) * this.maxConcurrency + index;
        
        try {
          if (progressCallback) {
            progressCallback(`📂 [${globalIndex + 1}/${sourceFolderIds.length}] Starting folder: ${folderId}...`);
          }

          // Check access first
          const accessCheck = await this.checkFolderAccess(folderId);
          if (!accessCheck.hasAccess) {
            throw new Error(`${accessCheck.message} (ID: ${folderId})`);
          }
          
          const folderName = accessCheck.folder.name;
          if (progressCallback) {
            progressCallback(`✅ [${globalIndex + 1}/${sourceFolderIds.length}] Processing: ${folderName}`);
          }

          const result = await this.copyFolderRecursiveParallel(
            folderId, 
            destinationFolderId, 
            (message, type) => {
              if (progressCallback) {
                progressCallback(`📁 [${globalIndex + 1}/${sourceFolderIds.length}] ${message}`, type);
              }
            }
          );

          results.completedFolders += 1;
          results.totalFiles += result.itemsCopied;
          results.totalSubfolders += result.subfolders;
          results.errors.push(...result.errors);
          results.folderResults.push(result);

          if (progressCallback) {
            progressCallback(
              `🎉 [${globalIndex + 1}/${sourceFolderIds.length}] Completed: ${result.folderName} ` +
              `(${result.itemsCopied} files, ${result.subfolders} subfolders)`,
              'success'
            );
          }

          return result;

        } catch (error) {
          const errorMsg = `❌ [${globalIndex + 1}/${sourceFolderIds.length}] Failed: ${error.message}`;
          results.errors.push(errorMsg);
          
          if (progressCallback) {
            progressCallback(errorMsg, 'error');
          }
          
          return { error: errorMsg };
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.allSettled(batchPromises);
    }

    if (progressCallback) {
      progressCallback(
        `🏁 Parallel copy complete! ${results.completedFolders}/${results.totalFolders} folders, ` +
        `${results.totalFiles} files, ${results.totalSubfolders} subfolders copied.`,
        'success'
      );
    }

    return results;
  }

  // Enhanced parallel folder copy with file batching
  async copyFolderRecursiveParallel(sourceFolderId, destinationFolderId, progressCallback = null) {
    try {
      // Get source folder information
      const sourceFolder = await this.getFolderInfo(sourceFolderId);
      if (progressCallback) {
        progressCallback(`📁 Processing folder: ${sourceFolder.name}`);
      }

      // Create the folder in destination
      const newFolder = await this.createFolder(sourceFolder.name, destinationFolderId);
      if (progressCallback) {
        progressCallback(`✅ Created folder: ${newFolder.name}`);
      }

      // List contents of the source folder
      const folderContents = await this.listFolderContents(sourceFolderId);
      if (progressCallback) {
        progressCallback(`📋 Found ${folderContents.length} items in ${sourceFolder.name}`);
      }

      const results = {
        folderId: newFolder.id,
        folderName: newFolder.name,
        itemsCopied: 0,
        subfolders: 0,
        errors: []
      };

      // Separate files and folders
      const files = folderContents.filter(item => item.mimeType !== 'application/vnd.google-apps.folder');
      const folders = folderContents.filter(item => item.mimeType === 'application/vnd.google-apps.folder');

      // Copy files in parallel batches
      if (files.length > 0) {
        const fileBatches = [];
        const fileBatchSize = 10; // Process 10 files at a time
        
        for (let i = 0; i < files.length; i += fileBatchSize) {
          fileBatches.push(files.slice(i, i + fileBatchSize));
        }

        for (const batch of fileBatches) {
          const filePromises = batch.map(async (file) => {
            try {
              if (progressCallback) {
                progressCallback(`📄 Copying file: ${file.name}`);
              }
              await this.copyFile(file.id, newFolder.id);
              results.itemsCopied++;
              if (progressCallback) {
                progressCallback(`✅ Copied: ${file.name}`);
              }
              return { success: true, name: file.name };
            } catch (error) {
              const errorMsg = `Failed to copy ${file.name}: ${error.message}`;
              results.errors.push(errorMsg);
              if (progressCallback) {
                progressCallback(`❌ ${errorMsg}`);
              }
              return { success: false, error: errorMsg };
            }
          });

          await Promise.allSettled(filePromises);
        }
      }

      // Copy subfolders in parallel (but limit concurrency)
      if (folders.length > 0) {
        const folderBatches = [];
        const folderBatchSize = 3; // Process 3 folders at a time to avoid too much recursion
        
        for (let i = 0; i < folders.length; i += folderBatchSize) {
          folderBatches.push(folders.slice(i, i + folderBatchSize));
        }

        for (const batch of folderBatches) {
          const folderPromises = batch.map(async (folder) => {
            try {
              if (progressCallback) {
                progressCallback(`📁 Copying subfolder: ${folder.name}`);
              }
              const subfolderResult = await this.copyFolderRecursiveParallel(folder.id, newFolder.id, progressCallback);
              results.subfolders++;
              results.itemsCopied += subfolderResult.itemsCopied;
              if (subfolderResult.errors.length > 0) {
                results.errors.push(...subfolderResult.errors);
              }
              return subfolderResult;
            } catch (error) {
              const errorMsg = `Failed to copy subfolder ${folder.name}: ${error.message}`;
              results.errors.push(errorMsg);
              if (progressCallback) {
                progressCallback(`❌ ${errorMsg}`);
              }
              return { error: errorMsg };
            }
          });

          await Promise.allSettled(folderPromises);
        }
      }

      return results;

    } catch (error) {
      if (progressCallback) {
        progressCallback(`❌ Failed to copy folder ${sourceFolderId}: ${error.message}`);
      }
      throw error;
    }
  }

  // Copy all existing DriveAPI methods
  async getFolderInfo(folderId) {
    const url = `${this.baseUrl}/files/${folderId}?` + new URLSearchParams({
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: 'id,name,mimeType,parents,capabilities'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get folder info: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  async listFolderContents(folderId) {
    const url = `${this.baseUrl}/files?` + new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: 'files(id,name,mimeType,size,parents,capabilities)',
      pageSize: '1000'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to list folder contents: ${error.error?.message || response.statusText}`);
    }

    const result = await response.json();
    return result.files || [];
  }

  async copyFile(sourceFileId, destinationFolderId, newFileName = null) {
    const copyMetadata = {
      parents: [destinationFolderId]
    };
    
    if (newFileName) {
      copyMetadata.name = newFileName;
    }

    const url = `${this.baseUrl}/files/${sourceFileId}/copy?` + new URLSearchParams({
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: 'id,name,mimeType,size'
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(copyMetadata)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to copy file: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  async createFolder(folderName, parentFolderId) {
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };

    const url = `${this.baseUrl}/files?` + new URLSearchParams({
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: 'id,name,mimeType'
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(folderMetadata)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create folder: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  async checkFolderAccess(folderId) {
    try {
      const folder = await this.getFolderInfo(folderId);
      if (!folder || !folder.name) {
        throw new Error('Folder data is incomplete or corrupted');
      }
      return {
        hasAccess: true,
        folder: folder,
        message: `Access verified for folder: ${folder.name}`
      };
    } catch (error) {
      let errorType = 'unknown';
      let errorMessage = error.message || 'Unknown error occurred';
      
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        errorType = 'not_found';
        errorMessage = 'Folder not found or not accessible. It may be in a different account or not properly shared.';
      } else if (errorMessage.includes('403') || errorMessage.includes('forbidden')) {
        errorType = 'permission_denied';
        errorMessage = 'Permission denied. You may not have access to this folder or it may have limited access restrictions.';
      } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
        errorType = 'auth_error';
        errorMessage = 'Authentication error. Please re-authorize the extension.';
      } else if (errorMessage.includes('incomplete') || errorMessage.includes('corrupted')) {
        errorType = 'data_error';
        errorMessage = 'Folder data is incomplete - this may be a shared folder with limited metadata access.';
      }
      
      return {
        hasAccess: false,
        errorType: errorType,
        message: errorMessage,
        originalError: errorMessage,
        folderId: folderId
      };
    }
  }
}

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
    
    return true;
  } else if (request.action === 'startParallelCopy') {
    startParallelCopyJob(request.batchId, request.folders, request.driveToken, sender.tab.id)
      .then(jobId => {
        sendResponse({ success: true, jobId: jobId });
      })
      .catch(error => {
        console.error('Error starting parallel copy:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  } else if (request.action === 'getCopyJobStatus') {
    const job = copyJobManager.getJob(request.jobId);
    if (job) {
      sendResponse({ success: true, job: job });
    } else {
      sendResponse({ success: false, error: 'Job not found' });
    }
    
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
    
    return true;
  }
});

// Start a parallel copy job in the background
async function startParallelCopyJob(batchId, folders, driveToken, tabId) {
  const job = copyJobManager.createJob(batchId, folders, driveToken);
  
  // Start the copy process asynchronously
  copyJobManager.updateJob(job.id, { status: 'running' });
  
  const backgroundDriveAPI = new BackgroundDriveAPI(driveToken);
  
  try {
    // Create batch folder first
    const batchFolder = await backgroundDriveAPI.createFolder(`Delivery_Batch_${batchId}`);
    copyJobManager.updateJob(job.id, { 
      batchFolderId: batchFolder.id,
      progress: 10 
    });
    
    // Send initial update to content script
    chrome.tabs.sendMessage(tabId, {
      action: 'copyJobUpdate',
      jobId: job.id,
      update: {
        status: 'copying',
        progress: 10,
        message: `Created batch folder: ${batchFolder.name}`
      }
    });

    // Extract folder IDs
    const sourceFolderIds = folders.map(url => extractFolderIdFromUrl(url));
    
    // Start parallel copy with progress updates
    const results = await backgroundDriveAPI.copyMultipleFoldersParallel(
      sourceFolderIds,
      batchFolder.id,
      (message, type) => {
        // Calculate progress based on completed folders
        const currentJob = copyJobManager.getJob(job.id);
        const progressPercent = 10 + (currentJob.completedFolders / currentJob.totalFolders) * 85;
        
        copyJobManager.updateJob(job.id, { 
          progress: Math.min(progressPercent, 95)
        });
        
        // Send progress update to content script
        chrome.tabs.sendMessage(tabId, {
          action: 'copyJobUpdate',
          jobId: job.id,
          update: {
            status: 'copying',
            progress: Math.min(progressPercent, 95),
            message: message,
            type: type
          }
        });
        
        // Update completed folders count when a folder is completed
        if (type === 'success' && message.includes('Completed:')) {
          const currentJob = copyJobManager.getJob(job.id);
          copyJobManager.updateJob(job.id, { 
            completedFolders: currentJob.completedFolders + 1
          });
        }
      }
    );

    // Job completed successfully
    copyJobManager.updateJob(job.id, {
      status: 'completed',
      progress: 100,
      results: results,
      endTime: Date.now()
    });

    // Send completion message to content script
    chrome.tabs.sendMessage(tabId, {
      action: 'copyJobUpdate',
      jobId: job.id,
      update: {
        status: 'completed',
        progress: 100,
        message: `Copy completed! ${results.completedFolders}/${results.totalFolders} folders, ${results.totalFiles} files copied.`,
        type: 'success',
        batchFolderId: batchFolder.id
      }
    });

  } catch (error) {
    // Job failed
    copyJobManager.updateJob(job.id, {
      status: 'failed',
      error: error.message,
      endTime: Date.now()
    });

    // Send error message to content script
    chrome.tabs.sendMessage(tabId, {
      action: 'copyJobUpdate',
      jobId: job.id,
      update: {
        status: 'failed',
        message: `Copy failed: ${error.message}`,
        type: 'error'
      }
    });
  }
  
  return job.id;
}

// Extract folder ID from Google Drive URL
function extractFolderIdFromUrl(url) {
  const match = url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

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
    console.log(`Attempting to get token with interactive: ${interactive}`);
    
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
          console.error('Chrome identity API error:', chrome.runtime.lastError);
          console.error('Full error details:', JSON.stringify(chrome.runtime.lastError, null, 2));
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!token) {
          console.error('No token received from Chrome identity API');
          reject(new Error('No token received'));
          return;
        }
        
        console.log('Token received, validating...');
        
        // Validate the token by making a test API call
        try {
          const isValid = await validateToken(token);
          if (isValid) {
            console.log('Token validation successful');
            resolve(token);
          } else {
            console.error('Token validation failed');
            // Token is invalid, remove it from cache
            chrome.identity.removeCachedAuthToken({ token: token }, () => {
              reject(new Error('Token validation failed'));
            });
          }
        } catch (error) {
          console.error('Token validation error:', error);
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
  const invalidTasks = [];
  
  for (const item of tasksData.data) {
    if (item.task && item.task.statement) {
      const statement = item.task.statement;
      const parsed = parseTaskStatementBackground(statement);
      if (parsed.repo_id && parsed.instance_id) {
        taskInfo.push({
          ...parsed,
          taskId: item.task.id || 'unknown'
        });
      } else {
        invalidTasks.push({
          taskId: item.task.id || 'unknown',
          reason: 'Could not parse repo_id or instance_id from task statement'
        });
      }
    } else {
      invalidTasks.push({
        taskId: item.id || 'unknown',
        reason: 'Task missing statement data'
      });
    }
  }
  
  if (taskInfo.length === 0) {
    throw new Error('No valid task information found');
  }
  
  // Step 3: Fetch deliverable URLs for each task
  const deliverableFolders = [];
  const failedTasks = [...invalidTasks]; // Include initially invalid tasks
  
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
            instance_id: task.instance_id,
            taskId: task.taskId
          });
        } else {
          failedTasks.push({
            repo_id: task.repo_id,
            instance_id: task.instance_id,
            taskId: task.taskId,
            reason: 'No deliverable_url found in job result'
          });
        }
      } else {
        let reason = `HTTP ${jobResponse.status} ${jobResponse.statusText}`;
        
        // Try to get more specific error info
        try {
          const errorData = await jobResponse.json();
          if (errorData.message) {
            reason = `${reason}: ${errorData.message}`;
          }
        } catch (e) {
          // Ignore parsing errors for error response
        }
        
        failedTasks.push({
          repo_id: task.repo_id,
          instance_id: task.instance_id,
          taskId: task.taskId,
          reason: `Failed to fetch job data - ${reason}`
        });
      }
    } catch (error) {
      failedTasks.push({
        repo_id: task.repo_id,
        instance_id: task.instance_id,
        taskId: task.taskId,
        reason: `Network or parsing error: ${error.message}`
      });
    }
  }
  
  return {
    successfulFolders: deliverableFolders,
    failedTasks: failedTasks,
    totalTasks: tasksData.data.length
  };
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