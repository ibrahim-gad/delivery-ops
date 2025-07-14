// Extract batch ID from URL
function getBatchId() {
  const urlPattern = /\/delivery\/(\d+)\/view\/tasks/;
  const match = window.location.pathname.match(urlPattern);
  return match ? match[1] : null;
}

// Get user token from localStorage
function getUserToken() {
  try {
    const persistAuth = localStorage.getItem('persist:auth');
    if (persistAuth) {
      const authData = JSON.parse(persistAuth);
      const token = JSON.parse(authData.token);
      return token;
    }
  } catch (error) {
    console.error('Error getting user token:', error);
  }
  return null;
}

// Create and inject the "Copy to Drive" button
function createCopyButton() {
  const batchId = getBatchId();
  if (!batchId) {
    console.log('No batch ID found in URL');
    return;
  }

  // Find the Edit button
  const editButton = document.querySelector('button[type="button"].chakra-button.css-ic7jay');
  if (!editButton || editButton.textContent.trim() !== 'Edit') {
    console.log('Edit button not found');
    return;
  }

  // Check if our button already exists
  if (document.getElementById('copy-to-drive-btn')) {
    return;
  }

  // Create the Copy to Drive button
  const copyButton = document.createElement('button');
  copyButton.id = 'copy-to-drive-btn';
  copyButton.type = 'button';
  copyButton.className = 'chakra-button css-ic7jay copy-drive-btn';
  copyButton.textContent = 'Copy to Drive';
  
  copyButton.addEventListener('click', () => {
    showModal(batchId);
  });

  // Insert after the Edit button
  editButton.parentNode.insertBefore(copyButton, editButton.nextSibling);
}

// Show the modal
function showModal(batchId) {
  const modal = createModal(batchId);
  document.body.appendChild(modal);
  
  // Don't start automatically - wait for user to click start
}

// Global state for copy process
let isCopyingInProgress = false;

// Create modal HTML
function createModal(batchId) {
  const modal = document.createElement('div');
  modal.id = 'delivery-ops-modal';
  modal.className = 'delivery-ops-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Copy Delivery Folders to Drive</h3>
        <button class="close-modal" id="header-close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="batch-info">
          <strong>Batch ID:</strong> ${batchId}
        </div>
        <div class="fetch-section">
          <button id="fetch-folders-btn" class="btn-fetch">Fetch Google Drive Folders</button>
          <p class="fetch-description">Click to fetch the actual Google Drive folders for this batch from the delivery system.</p>
        </div>
        <div class="folders-info" style="display: none;">
          <h4>Folders to Copy:</h4>
          <ul class="folders-list" id="folders-list">
            <!-- Folders will be populated here -->
          </ul>
          <div class="folders-count" id="folders-count">
            <!-- Count will be populated here -->
          </div>
        </div>
        <div class="start-section" style="display: none;">
          <button id="start-copy-btn" class="btn-start">Start Parallel Copy Process</button>
          <p class="start-description">⚡ This will create a folder named "Delivery_Batch_${batchId}" in your Google Drive and copy all folders using optimized parallel processing for maximum speed. The process runs in the background - you can even navigate away from this page!</p>
        </div>
        <div class="status-container" style="display: none;">
          <div class="status-item">
            <span class="status-label">Authenticating with Google Drive...</span>
            <span class="status-icon" id="auth-status">⏳</span>
          </div>
          <div class="status-item">
            <span class="status-label">Creating batch folder & starting parallel jobs...</span>
            <span class="status-icon" id="folder-status">⏳</span>
          </div>
          <div class="status-item">
            <span class="status-label">⚡ Processing folders in parallel...</span>
            <span class="status-icon" id="copy-status">⏳</span>
          </div>
        </div>
        <div class="progress-container" style="display: none;">
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
          <div class="progress-text" id="progress-text">0% Complete</div>
        </div>
        <div class="log-container" style="display: none;">
          <div class="log-header">Process Log:</div>
          <div class="log-content" id="log-content"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-close" id="footer-close-btn">Close</button>
      </div>
    </div>
  `;
  
  // Add event listeners for buttons
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'fetch-folders-btn') {
      fetchDeliveryFolders(batchId);
    } else if (e.target.id === 'start-copy-btn') {
      startCopyProcess(batchId);
    } else if (e.target.id === 'header-close-btn' || e.target.id === 'footer-close-btn') {
      attemptCloseModal(modal);
    }
  });
  
  // Prevent modal from closing when clicking outside during copy process
  modal.addEventListener('click', (e) => {
    if (e.target === modal && isCopyingInProgress) {
      e.stopPropagation();
      return false;
    } else if (e.target === modal) {
      modal.remove();
    }
  });
  
  return modal;
}

// Attempt to close modal (with copy process check)
function attemptCloseModal(modal) {
  if (isCopyingInProgress) {
    // Show a subtle indicator that closing is disabled
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.animation = 'shake 0.3s ease-in-out';
      setTimeout(() => {
        modalContent.style.animation = '';
      }, 300);
    }
    return false;
  }
  modal.remove();
  return true;
}

// Add log entry to modal
function addLogEntry(message, type = 'info', isHTML = false) {
  const logContent = document.getElementById('log-content');
  if (logContent) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    
    const timestamp = `${new Date().toLocaleTimeString()}: `;
    if (isHTML) {
      logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span>${message}`;
    } else {
      logEntry.textContent = `${timestamp}${message}`;
    }
    
    logContent.appendChild(logEntry);
    
    // Force auto-scroll to bottom with smooth behavior
    requestAnimationFrame(() => {
      logContent.scrollTop = logContent.scrollHeight;
      logEntry.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }
}

// Update status icon
function updateStatus(statusId, status) {
  const statusElement = document.getElementById(statusId);
  if (statusElement) {
    switch (status) {
      case 'loading':
        statusElement.textContent = '⏳';
        break;
      case 'success':
        statusElement.textContent = '✅';
        break;
      case 'error':
        statusElement.textContent = '❌';
        break;
    }
  }
}

// Update progress
function updateProgress(percentage) {
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  
  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }
  
  if (progressText) {
    progressText.textContent = `${Math.round(percentage)}% Complete`;
  }
}

// Update modal UI based on copying state
function updateModalCloseState() {
  const headerCloseBtn = document.getElementById('header-close-btn');
  const footerCloseBtn = document.getElementById('footer-close-btn');
  
  if (headerCloseBtn && footerCloseBtn) {
    if (isCopyingInProgress) {
      headerCloseBtn.disabled = true;
      footerCloseBtn.disabled = true;
      headerCloseBtn.style.opacity = '0.5';
      footerCloseBtn.style.opacity = '0.5';
      headerCloseBtn.style.cursor = 'not-allowed';
      footerCloseBtn.style.cursor = 'not-allowed';
      footerCloseBtn.textContent = 'Copying... Please wait';
    } else {
      headerCloseBtn.disabled = false;
      footerCloseBtn.disabled = false;
      headerCloseBtn.style.opacity = '1';
      footerCloseBtn.style.opacity = '1';
      headerCloseBtn.style.cursor = 'pointer';
      footerCloseBtn.style.cursor = 'pointer';
      footerCloseBtn.textContent = 'Close';
    }
  }
}

// Start the copy process
async function startCopyProcess(batchId) {
  // Get folders from global storage (set by fetchDeliveryFolders)
  const foldersToMigrate = window.deliveryFolders || [];
  
  if (foldersToMigrate.length === 0) {
    addLogEntry('No folders to migrate. Please fetch folders first.', 'error');
    return;
  }

  // Set copying state and update UI
  isCopyingInProgress = true;
  updateModalCloseState();

  // Hide the start section and show progress sections
  document.querySelector('.start-section').style.display = 'none';
  document.querySelector('.status-container').style.display = 'block';
  document.querySelector('.progress-container').style.display = 'block';
  document.querySelector('.log-container').style.display = 'block';

  let batchFolderId = null;

  try {
    addLogEntry('🚀 Starting optimized parallel copy process...');
    updateProgress(5);

    // Step 1: Get user token
    const userToken = getUserToken();
    if (!userToken) {
      throw new Error('Could not retrieve user authentication token');
    }
    
    addLogEntry('User token retrieved successfully');
    updateStatus('auth-status', 'success');
    updateProgress(10);

    // Step 2: Get Google Drive access token
    addLogEntry('Requesting Google Drive access...');
    const driveToken = await getGoogleDriveToken();
    
    // Step 2.5: Check which Google account we're using
    addLogEntry('Checking Google account info...');
    try {
      const accountInfo = await getUserInfo(driveToken);
      addLogEntry(`✅ Authenticated as: ${accountInfo.email}`, 'info');
    } catch (error) {
      addLogEntry('Could not retrieve account info', 'error');
    }

    updateProgress(15);

    // Step 3: Start background parallel copy job
    addLogEntry(`⚡ Starting parallel copy job for ${foldersToMigrate.length} folders...`);
    updateStatus('folder-status', 'loading');
    updateStatus('copy-status', 'loading');
    
    const jobResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { 
          action: 'startParallelCopy', 
          batchId: batchId,
          folders: foldersToMigrate,
          driveToken: driveToken
        },
        (response) => {
          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Failed to start parallel copy job'));
          }
        }
      );
    });

    const jobId = jobResponse.jobId;
    addLogEntry(`📋 Copy job started (ID: ${jobId}). Processing in background with parallel operations...`);
    
    // Job is now running in background - updates will come via messages
    addLogEntry('🏃‍♂️ Copy job is running in the background. You can navigate away from this page if needed.');
    
  } catch (error) {
    console.error('Copy process failed:', error);
    addLogEntry(`❌ Error: ${error.message}`, 'error');
    updateStatus('auth-status', 'error');
    updateStatus('folder-status', 'error');
    updateStatus('copy-status', 'error');
    
    // Reset copying state
    isCopyingInProgress = false;
    updateModalCloseState();
  }
}

  // Get Google Drive access token
  async function getGoogleDriveToken() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'getGoogleDriveToken' },
        (response) => {
          if (response.success) {
            resolve(response.token);
          } else {
            reject(new Error(response.error || 'Failed to get Google Drive token'));
          }
        }
      );
    });
  }

  // Get current user info
  async function getUserInfo(accessToken) {
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json();
    return data.user;
  }

  // Extract folder ID from Google Drive URL
function extractFolderIdFromUrl(url) {
  const match = url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Fetch delivery folders from API (via background script)
async function fetchDeliveryFolders(batchId) {
  const fetchBtn = document.getElementById('fetch-folders-btn');
  const foldersInfo = document.querySelector('.folders-info');
  const startSection = document.querySelector('.start-section');
  
  try {
    // Disable fetch button and show loading
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';
    
    // Get user token
    const userToken = getUserToken();
    if (!userToken) {
      throw new Error('Could not retrieve user authentication token');
    }
    
    // Call background script to fetch folders with proper permissions
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { 
          action: 'fetchDeliveryFolders', 
          batchId: batchId, 
          userToken: userToken 
        },
        (response) => {
          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Failed to fetch delivery folders'));
          }
        }
      );
    });
    
    const result = response.folders;
    const successfulFolders = result.successfulFolders || [];
    const failedTasks = result.failedTasks || [];
    const totalTasks = result.totalTasks || 0;
    
    // Update UI with fetched folders
    window.deliveryFolders = successfulFolders.map(f => f.url);
    
    const foldersList = document.getElementById('folders-list');
    const foldersCount = document.getElementById('folders-count');
    
    // Build HTML for successful folders
    let foldersHTML = '';
    if (successfulFolders.length > 0) {
      foldersHTML += '<div class="success-section">';
      foldersHTML += '<h5>✅ Successfully Found Folders:</h5>';
      foldersHTML += successfulFolders.map(folder => 
        `<li>
          <a href="${folder.url}" target="_blank">${folder.url}</a> 
          <span class="verify-link">(click to verify access)</span>
          <br><small><strong>Repo:</strong> ${folder.repo_id} | <strong>Instance:</strong> ${folder.instance_id}</small>
        </li>`
      ).join('');
      foldersHTML += '</div>';
    }
    
    // Build HTML for failed tasks
    if (failedTasks.length > 0) {
      if (successfulFolders.length > 0) {
        foldersHTML += '<hr class="section-divider">';
      }
      foldersHTML += '<div class="failed-section">';
      foldersHTML += '<h5>❌ Failed to Get Drive Folders:</h5>';
      foldersHTML += failedTasks.map(task => 
        `<li class="failed-task-item">
          <div><strong>Task ID:</strong> ${task.taskId || 'Unknown'}</div>
          <div><strong>Instance ID:</strong> ${task.instance_id || 'Unknown'}</div>
          <div><strong>Repo ID:</strong> ${task.repo_id || 'Unknown'}</div>
          <div class="task-reason"><strong>Reason:</strong> ${task.reason}</div>
        </li>`
      ).join('');
      foldersHTML += '</div>';
    }
    
    foldersList.innerHTML = foldersHTML;
    
    // Update count with breakdown
    let countHTML = `<strong>Total tasks analyzed: ${totalTasks}</strong><br>`;
    countHTML += `<span class="success-count">✅ Folders to copy: ${successfulFolders.length}</span>`;
    if (failedTasks.length > 0) {
      countHTML += `<span class="failed-count">❌ Failed: ${failedTasks.length}</span>`;
    }
    
    foldersCount.innerHTML = countHTML;
    
    // Show folders info and start section (only if we have successful folders)
    foldersInfo.style.display = 'block';
    if (successfulFolders.length > 0) {
      startSection.style.display = 'block';
    } else {
      // Hide start section if no folders to copy
      startSection.style.display = 'none';
    }
    
    // Hide fetch section
    document.querySelector('.fetch-section').style.display = 'none';
    
  } catch (error) {
    console.error('Error fetching delivery folders:', error);
    alert(`Error fetching folders: ${error.message}`);
    
    // Re-enable fetch button
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch Google Drive Folders';
  }
}





// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'copyJobUpdate') {
    handleCopyJobUpdate(message.jobId, message.update);
  }
});

// Handle copy job updates from background script
function handleCopyJobUpdate(jobId, update) {
  if (update.message) {
    addLogEntry(update.message, update.type || 'info');
  }
  
  if (update.progress !== undefined) {
    updateProgress(update.progress);
  }
  
  if (update.status === 'copying') {
    // Keep the copy status as loading during the process
    updateStatus('copy-status', 'loading');
  } else if (update.status === 'completed') {
    updateStatus('folder-status', 'success');
    updateStatus('copy-status', 'success');
    updateProgress(100);
    
    // Reset copying state and re-enable modal closing
    isCopyingInProgress = false;
    updateModalCloseState();
    
    // Create final message with link to the Google Drive folder
    if (update.batchFolderId) {
      const driveUrl = `https://drive.google.com/drive/folders/${update.batchFolderId}`;
      const linkMessage = `🎉 Copy process finished! <a href="${driveUrl}" target="_blank" rel="noopener noreferrer" style="color: #63b3ed; text-decoration: underline;">Open the new Google Drive folder</a> or close this modal.`;
      addLogEntry(linkMessage, 'success', true);
    } else {
      addLogEntry('🎉 Copy process finished. You can now close this modal.', 'success');
    }
  } else if (update.status === 'failed') {
    updateStatus('auth-status', 'error');
    updateStatus('folder-status', 'error');
    updateStatus('copy-status', 'error');
    
    // Reset copying state and re-enable modal closing
    isCopyingInProgress = false;
    updateModalCloseState();
    
    addLogEntry('❌ Copy process failed. You can now close this modal.', 'error');
  }
}

// Initialize the extension
function init() {
  // Check if we're on the correct page
  if (window.location.pathname.match(/\/delivery\/\d+\/view\/tasks/)) {
    // Wait for the page to load and try to add the button
    const observer = new MutationObserver((mutations, obs) => {
      createCopyButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also try immediately in case the button is already there
    setTimeout(createCopyButton, 1000);
  }
}

// Helper function to clear cached authentication (callable from console)
window.clearDeliveryOpsAuth = function() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'clearAuth' }, (response) => {
      if (response.success) {
        console.log('✅ Authentication cleared successfully!');
        console.log('You may need to refresh the page and re-authenticate on next use.');
        resolve(response.message);
      } else {
        console.error('❌ Failed to clear authentication:', response.error);
        reject(new Error(response.error));
      }
    });
  });
};

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 