// Google Drive API helper functions for the Delivery Ops extension

class DriveAPI {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
  }

  // Get headers for API requests
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  // Get folder information with proper shared drive support
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

  // List folder contents with proper shared drive support
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

  // Copy a single file using the proper Google Drive API copy method
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

  // Create a folder in the destination
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

  // Recursively copy an entire folder structure with proper Google Drive API usage
  async copyFolderRecursive(sourceFolderId, destinationFolderId, progressCallback = null) {
    try {
      // Get source folder information
      let sourceFolder;
      try {
        sourceFolder = await this.getFolderInfo(sourceFolderId);
        if (progressCallback) {
          progressCallback(`📁 Processing folder: ${sourceFolder.name}`);
        }
      } catch (error) {
        if (progressCallback) {
          progressCallback(`❌ Cannot access folder ${sourceFolderId}: ${error.message}`);
        }
        throw error;
      }

      // Create the folder in destination
      const newFolder = await this.createFolder(sourceFolder.name, destinationFolderId);
      if (progressCallback) {
        progressCallback(`✅ Created folder: ${newFolder.name}`);
      }

      // List contents of the source folder
      let folderContents;
      try {
        folderContents = await this.listFolderContents(sourceFolderId);
        if (progressCallback) {
          progressCallback(`📋 Found ${folderContents.length} items in ${sourceFolder.name}`);
        }
      } catch (error) {
        if (progressCallback) {
          progressCallback(`⚠️ Cannot list contents of ${sourceFolder.name}: ${error.message}`);
        }
        // Return the created folder even if we can't list contents
        return {
          folderId: newFolder.id,
          folderName: newFolder.name,
          itemsCopied: 0,
          subfolders: 0,
          errors: [`Cannot access folder contents: ${error.message}`]
        };
      }

      const results = {
        folderId: newFolder.id,
        folderName: newFolder.name,
        itemsCopied: 0,
        subfolders: 0,
        errors: []
      };

      // Process each item in the folder
      for (const item of folderContents) {
        try {
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            // Recursively copy subfolder
            if (progressCallback) {
              progressCallback(`📁 Copying subfolder: ${item.name}`);
            }
            const subfolderResult = await this.copyFolderRecursive(item.id, newFolder.id, progressCallback);
            results.subfolders++;
            results.itemsCopied += subfolderResult.itemsCopied;
            if (subfolderResult.errors.length > 0) {
              results.errors.push(...subfolderResult.errors);
            }
          } else {
            // Copy file
            if (progressCallback) {
              progressCallback(`📄 Copying file: ${item.name}`);
            }
            await this.copyFile(item.id, newFolder.id);
            results.itemsCopied++;
            if (progressCallback) {
              progressCallback(`✅ Copied: ${item.name}`);
            }
          }
        } catch (error) {
          const errorMsg = `Failed to copy ${item.name}: ${error.message}`;
          results.errors.push(errorMsg);
          if (progressCallback) {
            progressCallback(`❌ ${errorMsg}`);
          }
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

  // Check if user has access to a folder using proper API
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

  // Get file metadata
  async getFile(fileId) {
    const response = await fetch(
      `${this.baseUrl}/files/${fileId}?fields=id,name,mimeType,parents,size`,
      {
        method: 'GET',
        headers: this.getHeaders()
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get file: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  // Get permissions for a file/folder (utility method)
  async getPermissions(fileId) {
    const url = `${this.baseUrl}/files/${fileId}/permissions?` + new URLSearchParams({
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to get permissions: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  // Batch copy multiple folders with detailed progress tracking
  async copyMultipleFolders(sourceFolderIds, destinationFolderId, progressCallback = null) {
    const results = {
      totalFolders: sourceFolderIds.length,
      completedFolders: 0,
      totalFiles: 0,
      totalSubfolders: 0,
      errors: [],
      folderResults: []
    };

    if (progressCallback) {
      progressCallback(`🚀 Starting batch copy of ${sourceFolderIds.length} folders...`);
    }

    for (let i = 0; i < sourceFolderIds.length; i++) {
      const folderId = sourceFolderIds[i];
      
      try {
        if (progressCallback) {
          progressCallback(`📂 [${i + 1}/${sourceFolderIds.length}] Preparing folder: ${folderId}...`);
        }

        // Check access first with detailed logging
        const accessCheck = await this.checkFolderAccess(folderId);
        if (!accessCheck.hasAccess) {
          throw new Error(`${accessCheck.message} (ID: ${folderId})`);
        }
        
        const folderName = accessCheck.folder.name;
        if (progressCallback) {
          progressCallback(`✅ [${i + 1}/${sourceFolderIds.length}] Access verified: ${folderName} (via ${accessCheck.message})`);
        }

        const result = await this.copyFolderRecursive(
          folderId, 
          destinationFolderId, 
          (message, type) => {
            if (progressCallback) {
              progressCallback(`📁 [${i + 1}/${sourceFolderIds.length}] ${message}`, type);
            }
          }
        );

        results.folderResults.push(result);
        results.completedFolders += 1;
        results.totalFiles += result.itemsCopied;
        results.totalSubfolders += result.subfolders;
        results.errors.push(...result.errors);

        if (progressCallback) {
          progressCallback(
            `🎉 [${i + 1}/${sourceFolderIds.length}] Completed: ${result.folderName} ` +
            `(${result.itemsCopied} files, ${result.subfolders} subfolders)`,
            'success'
          );
        }

      } catch (error) {
        const errorMsg = `❌ [${i + 1}/${sourceFolderIds.length}] Failed: ${error.message}`;
        results.errors.push(errorMsg);
        
        if (progressCallback) {
          progressCallback(errorMsg, 'error');
        }
      }
    }

    if (progressCallback) {
      progressCallback(
        `🏁 Batch copy complete! ${results.completedFolders}/${results.totalFolders} folders, ` +
        `${results.totalFiles} files, ${results.totalSubfolders} subfolders copied.`,
        'success'
      );
    }

    return results;
  }
}

// Export for use in content script
window.DriveAPI = DriveAPI; 