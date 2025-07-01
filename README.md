# Delivery Ops Chrome Extension

A Chrome extension that helps streamline delivery operations by integrating with Google Drive and Turing's evaluation system to fetch and manage delivery folders.

## Features

- 🔐 Google Drive authentication integration
- 📁 Automatic fetching of delivery folders from Turing evaluation system
- 🔄 Batch processing of delivery tasks
- 🚀 Background processing for improved performance

## Prerequisites

- Google Chrome browser
- Access to Turing evaluation system
- Google account with Drive permissions

## Installation (Load Unpacked)

### Step 1: Enable Developer Mode
1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Toggle on **Developer mode** in the top-right corner

### Step 2: Load the Extension
1. Click the **Load unpacked** button
2. Navigate to the folder containing this extension's files
3. Select the folder and click **Select Folder**
4. The extension should now appear in your extensions list

### Step 3: Verify Installation
- Look for the "Delivery Ops" extension in your extensions list
- Make sure it's enabled (toggle should be blue/on)
- You may see the extension icon in your Chrome toolbar

## How to Use

### Initial Setup
1. Navigate to a Turing delivery page (e.g., `https://eval.turing.com/delivery/{id}/view/tasks`)
2. The extension will automatically detect when you're on a supported page
3. When prompted, authorize Google Drive access

### Using the Extension
1. **Automatic Detection**: The extension automatically activates on Turing delivery pages
2. **Google Drive Auth**: Click to authenticate with Google Drive when prompted
3. **Fetch Folders**: The extension will automatically fetch delivery folders for the current batch
4. **View Results**: Delivery folders and their URLs will be displayed in the interface

### Authentication Management
- **Clear Auth**: Use the clear authentication option if you need to switch Google accounts
- **Re-authenticate**: The extension will prompt for re-authentication when tokens expire

## File Structure

```
deliver_ops/
├── background.js     # Background service worker
├── content.js        # Content script for page interaction
├── drive-api.js      # Google Drive API integration
├── manifest.json     # Extension configuration
├── package.json      # Dependencies
├── styles.css        # Extension styling
└── SETUP.md         # Additional setup information
```

## Troubleshooting

### Extension Not Loading
- Ensure all files are in the same directory
- Check that `manifest.json` is properly formatted
- Verify Developer mode is enabled in Chrome extensions

### Authentication Issues
- Clear existing authentication: Use the "Clear Auth" option
- Check Google account permissions
- Ensure you have Drive API access

### Page Not Detected
- Verify you're on a Turing delivery page with the correct URL pattern
- Check that the page has fully loaded
- Try refreshing the page

### API Errors
- Check network connectivity
- Verify your Turing account has proper permissions
- Look at Chrome DevTools console for detailed error messages

## Development

### Debug Mode
1. Right-click the extension icon → "Inspect popup" (if applicable)
2. Go to `chrome://extensions/` → Click "Inspect views: background page"
3. Use Chrome DevTools to debug content script on target pages

### Console Logging
The extension logs important events to the console:
- Authentication status
- API calls and responses
- Error messages and warnings

## Permissions

This extension requires the following permissions:
- `identity` - For Google OAuth authentication
- `activeTab` - To interact with the current tab
- `storage` - To store authentication tokens
- Host permissions for Turing and Google APIs

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Chrome DevTools console for error messages
3. Verify all prerequisites are met
4. Check that you're using the latest version of Chrome

## Version History

- Initial release: Basic Google Drive integration and delivery folder fetching 