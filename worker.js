/**
 * Cross-Channel Reply Blocker Bot for Cloudflare Workers
 * 
 * This bot automatically deletes all cross-channel reply messages in Telegram groups
 * where it has admin permissions. It distinguishes between linked channel replies
 * (allowed) and external channel replies (blocked).
 * 
 * @version 2.0.0
 * @author Bot Developer
 * @license MIT
 */

// Configuration constants
const CONFIG = {
  TELEGRAM_API_URL: 'https://api.telegram.org/bot',
  WARNING_MESSAGE_TEXT: '⚠️ 本群禁止跨频道回复内容',
  WARNING_AUTO_DELETE_DELAY: 10000, // 10 seconds in milliseconds
  REQUEST_TIMEOUT: 30000, // 30 seconds timeout for HTTP requests
  MAX_RETRIES: 3, // Maximum retry attempts for failed requests
  CACHE_TTL: 300000, // 5 minutes cache TTL for chat info
  RATE_LIMIT_WINDOW: 60000, // 1 minute rate limiting window
  MAX_REQUESTS_PER_WINDOW: 30 // Maximum requests per rate limit window
};

// In-memory cache for chat information (optimizes repeated getChatInfo calls)
const chatInfoCache = new Map();

// Rate limiting tracker
const rateLimitTracker = new Map();

/**
 * Main worker entry point - ES Module format for modern Cloudflare Workers
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Environment variables and bindings
 * @param {ExecutionContext} ctx - Execution context for additional lifecycle methods
 * @returns {Promise<Response>} HTTP response
 */
export default {
  async fetch(request, env, ctx) {
    // Validate environment variables on startup
    if (!env.BOT_TOKEN) {
      console.error('❌ BOT_TOKEN environment variable is required');
      return new Response('Configuration Error', { status: 500 });
    }

    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('❌ Unhandled error in main fetch handler:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

/**
 * Handle incoming HTTP requests with proper routing and validation
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @returns {Promise<Response>} HTTP response
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Apply rate limiting to prevent abuse
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    console.warn(`🚫 Rate limit exceeded for IP: ${getClientIP(request)}`);
    return new Response('Rate limit exceeded', { 
      status: 429,
      headers: { 'Retry-After': '60' }
    });
  }

  // Health check endpoint - no authentication required
  if (pathname === '/health' && method === 'GET') {
    return new Response(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Webhook endpoint for Telegram updates
  if (pathname === '/webhook' && method === 'POST') {
    return await handleWebhook(request, env, ctx);
  }
  
  // Setup webhook endpoint - should be protected in production
  if (pathname === '/setup' && method === 'GET') {
    return await setupWebhook(request, env);
  }
  
  // Return 404 for all other routes
  console.warn(`🔍 Unknown route accessed: ${method} ${pathname}`);
  return new Response('Not Found', { status: 404 });
}

/**
 * Utility function to get client IP address from request
 * @param {Request} request - The HTTP request
 * @returns {string} Client IP address
 */
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For') || 
         'unknown';
}

/**
 * Rate limiting implementation using in-memory storage
 * @param {Request} request - The HTTP request
 * @returns {Promise<Object>} Rate limit result
 */
async function checkRateLimit(request) {
  const clientIP = getClientIP(request);
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW;

  // Clean up old entries
  for (const [ip, timestamps] of rateLimitTracker.entries()) {
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    if (validTimestamps.length === 0) {
      rateLimitTracker.delete(ip);
    } else {
      rateLimitTracker.set(ip, validTimestamps);
    }
  }

  // Check current IP
  const currentTimestamps = rateLimitTracker.get(clientIP) || [];
  const validTimestamps = currentTimestamps.filter(ts => ts > windowStart);

  if (validTimestamps.length >= CONFIG.MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, count: validTimestamps.length };
  }

  // Add current request
  validTimestamps.push(now);
  rateLimitTracker.set(clientIP, validTimestamps);

  return { allowed: true, count: validTimestamps.length };
}

/**
 * Handle Telegram webhook updates with enhanced validation and error handling
 * @param {Request} request - The HTTP request containing Telegram update
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @returns {Promise<Response>} HTTP response
 */
async function handleWebhook(request, env, ctx) {
  try {
    // Validate Content-Type
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('🚫 Invalid Content-Type for webhook request');
      return new Response('Invalid Content-Type', { status: 400 });
    }

    // Parse and validate update data
    let update;
    try {
      update = await request.json();
    } catch (parseError) {
      console.error('❌ Failed to parse webhook JSON:', parseError);
      return new Response('Invalid JSON', { status: 400 });
    }

    // Basic update validation
    if (!update || typeof update !== 'object' || !update.update_id) {
      console.warn('🚫 Invalid update structure received');
      return new Response('Invalid update format', { status: 400 });
    }

    console.log(`📨 Processing update ${update.update_id}`);
    
    // Process the update
    await processUpdate(update, env, ctx);
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Process Telegram update with comprehensive message type handling
 * @param {Object} update - Telegram update object
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @returns {Promise<void>}
 */
async function processUpdate(update, env, ctx) {
  try {
    // Handle regular messages
    if (update.message) {
      await handleMessage(update.message, env, ctx, false);
    }
    
    // Handle edited messages
    if (update.edited_message) {
      await handleMessage(update.edited_message, env, ctx, true);
    }

    // Future: Could handle other update types like channel_post, etc.
    // if (update.channel_post) {
    //   await handleChannelPost(update.channel_post, env, ctx);
    // }
  } catch (error) {
    console.error(`❌ Error processing update ${update.update_id}:`, error);
    // Don't throw here - we want to return 200 to Telegram even if processing fails
  }
}

/**
 * Handle incoming message with enhanced validation and processing
 * @param {Object} message - Telegram message object
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @param {boolean} isEdited - Whether this is an edited message
 * @returns {Promise<void>}
 */
async function handleMessage(message, env, ctx, isEdited = false) {
  try {
    // Validate message structure
    if (!message || !message.message_id || !message.chat) {
      console.warn('🚫 Invalid message structure received');
      return;
    }

    // Only process group and supergroup messages
    const chatType = message.chat.type;
    if (chatType !== 'group' && chatType !== 'supergroup') {
      console.debug(`🔍 Ignoring ${chatType} message (ID: ${message.message_id})`);
      return;
    }

    // Skip processing bot messages to avoid infinite loops
    if (message.from && message.from.is_bot) {
      console.debug(`🤖 Ignoring bot message from ${message.from.username || message.from.first_name}`);
      return;
    }

    const messageInfo = `message ${message.message_id} in chat ${message.chat.id}${isEdited ? ' (edited)' : ''}`;
    console.debug(`🔍 Processing ${messageInfo}`);
    
    // Check if this is a cross-channel reply
    const crossChannelInfo = await detectCrossChannelReply(message, env);
    
    if (crossChannelInfo.isCrossChannel && crossChannelInfo.isExternal) {
      console.log(`🎯 Detected external cross-channel reply: ${messageInfo} from ${crossChannelInfo.channelInfo.title}`);
      
      // Delete the message and send warning
      await deleteCrossChannelReply(message, env, ctx, isEdited);
    } else if (crossChannelInfo.isCrossChannel && !crossChannelInfo.isExternal) {
      console.debug(`✅ Allowing linked channel reply: ${messageInfo}`);
    }
  } catch (error) {
    console.error(`❌ Error handling message ${message?.message_id}:`, error);
    // Continue processing other messages even if one fails
  }
}

/**
 * Detect if a message is a cross-channel reply
 */
async function detectCrossChannelReply(message, env) {
  const result = {
    isCrossChannel: false,
    isExternal: false,
    channelInfo: {},
    replyType: 'none'
  };
  
  // Get current chat info to check for linked channels
  const currentChatInfo = await getChatInfo(message.chat.id, env);
  
  // Case 1: External reply (direct reply from channel to group)
  if (message.external_reply && message.external_reply.chat) {
    const externalChat = message.external_reply.chat;
    
    if (externalChat.type === 'channel') {
      result.isCrossChannel = true;
      result.replyType = 'external_reply';
      result.channelInfo = {
        id: externalChat.id,
        title: externalChat.title || 'Unknown Channel',
        username: externalChat.username || null
      };
      
      // Check if it's a linked channel
      if (currentChatInfo && isLinkedChannel(currentChatInfo, externalChat.id)) {
        result.isExternal = false; // It's a linked channel, allow it
        console.log(`Message ${message.message_id} is reply to LINKED channel ${externalChat.title}`);
      } else {
        result.isExternal = true; // It's an external channel, block it
        console.log(`Message ${message.message_id} is reply to EXTERNAL channel ${externalChat.title}`);
      }
      
      return result;
    }
  }
  
  // Case 2: Reply to a message in the group
  if (!message.reply_to_message) {
    return result;
  }
  
  const replyToMessage = message.reply_to_message;
  
  // Case 2a: Reply to a message forwarded from a channel
  if (replyToMessage.forward_from_chat && replyToMessage.forward_from_chat.type === 'channel') {
    const forwardChat = replyToMessage.forward_from_chat;
    result.isCrossChannel = true;
    result.replyType = 'forward_from_channel';
    result.channelInfo = {
      id: forwardChat.id,
      title: forwardChat.title || 'Unknown Channel',
      username: forwardChat.username || null
    };
    
    // Check if it's a linked channel
    if (currentChatInfo && isLinkedChannel(currentChatInfo, forwardChat.id)) {
      result.isExternal = false;
      console.log(`Message ${message.message_id} replies to message forwarded from LINKED channel ${forwardChat.title}`);
    } else {
      result.isExternal = true;
      console.log(`Message ${message.message_id} replies to message forwarded from EXTERNAL channel ${forwardChat.title}`);
    }
    
    return result;
  }
  
  // Case 2b: Reply to a message sent by a channel
  if (replyToMessage.sender_chat && replyToMessage.sender_chat.type === 'channel') {
    const senderChat = replyToMessage.sender_chat;
    result.isCrossChannel = true;
    result.replyType = 'sender_chat_channel';
    result.channelInfo = {
      id: senderChat.id,
      title: senderChat.title || 'Unknown Channel',
      username: senderChat.username || null
    };
    
    // Check if it's a linked channel
    if (currentChatInfo && isLinkedChannel(currentChatInfo, senderChat.id)) {
      result.isExternal = false;
      console.log(`Message ${message.message_id} replies to message from LINKED channel ${senderChat.title}`);
    } else {
      result.isExternal = true;
      console.log(`Message ${message.message_id} replies to message from EXTERNAL channel ${senderChat.title}`);
    }
    
    return result;
  }
  
  // Case 2c: Reply to a forwarded message with hidden origin
  if (replyToMessage.forward_sender_name || replyToMessage.forward_date) {
    result.isCrossChannel = true;
    result.isExternal = true; // Hidden forwards are considered external
    result.replyType = 'hidden_forward';
    result.channelInfo = {
      id: null,
      title: replyToMessage.forward_sender_name || 'Hidden Source',
      username: null
    };
    
    console.log(`Message ${message.message_id} replies to forwarded message with HIDDEN origin`);
    return result;
  }
  
  // Case 2d: Reply to a message with channel signature
  if (replyToMessage.forward_signature) {
    result.isCrossChannel = true;
    result.isExternal = true; // Signed forwards are considered external
    result.replyType = 'channel_signature';
    result.channelInfo = {
      id: null,
      title: `Channel (signature: ${replyToMessage.forward_signature})`,
      username: null
    };
    
    console.log(`Message ${message.message_id} replies to message with channel signature: ${replyToMessage.forward_signature}`);
    return result;
  }
  
  return result;
}

/**
 * Check if a channel is linked to the current chat
 */
function isLinkedChannel(groupChat, channelChatId) {
  // Check if the group has a linked channel and it matches the channel ID
  return groupChat.linked_chat_id && groupChat.linked_chat_id === channelChatId;
}

/**
 * Make API request to Telegram Bot API with retry logic and timeout
 * @param {string} method - API method name
 * @param {Object} params - Parameters for the API call
 * @param {Object} env - Environment variables
 * @param {number} retryCount - Current retry attempt (for internal use)
 * @returns {Promise<Object|null>} API response data or null if failed
 */
async function makeApiRequest(method, params = {}, env, retryCount = 0) {
  const url = `${CONFIG.TELEGRAM_API_URL}${env.BOT_TOKEN}/${method}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.ok) {
      return data.result;
    } else {
      console.warn(`⚠️ Telegram API error for ${method}:`, data);
      
      // Retry on specific error codes
      if (retryCount < CONFIG.MAX_RETRIES && isRetryableError(data.error_code)) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        console.log(`🔄 Retrying ${method} in ${delay}ms (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return makeApiRequest(method, params, env, retryCount + 1);
      }
      
      return null;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`⏰ Request timeout for ${method}`);
    } else {
      console.error(`❌ Network error for ${method}:`, error);
    }

    // Retry on network errors
    if (retryCount < CONFIG.MAX_RETRIES) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`🔄 Retrying ${method} in ${delay}ms (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeApiRequest(method, params, env, retryCount + 1);
    }

    return null;
  }
}

/**
 * Check if an error code is retryable
 * @param {number} errorCode - Telegram API error code
 * @returns {boolean} Whether the error is retryable
 */
function isRetryableError(errorCode) {
  // Retry on rate limiting and temporary server errors
  return [429, 502, 503, 504].includes(errorCode);
}

/**
 * Get chat information with caching and retry logic
 * @param {number|string} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 * @returns {Promise<Object|null>} Chat information or null if failed
 */
async function getChatInfo(chatId, env) {
  const cacheKey = `chat_${chatId}`;
  const now = Date.now();

  // Check cache first
  if (chatInfoCache.has(cacheKey)) {
    const cached = chatInfoCache.get(cacheKey);
    if (now - cached.timestamp < CONFIG.CACHE_TTL) {
      console.debug(`📋 Using cached chat info for ${chatId}`);
      return cached.data;
    } else {
      chatInfoCache.delete(cacheKey);
    }
  }

  try {
    const chatInfo = await makeApiRequest('getChat', { chat_id: chatId }, env);
    
    if (chatInfo) {
      // Cache successful result
      chatInfoCache.set(cacheKey, {
        data: chatInfo,
        timestamp: now
      });
      console.debug(`💾 Cached chat info for ${chatId}`);
    }
    
    return chatInfo;
  } catch (error) {
    console.error(`❌ Error getting chat info for ${chatId}:`, error);
    return null;
  }
}

/**
 * Delete cross-channel reply message and send warning with improved error handling
 * @param {Object} message - Telegram message object
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @param {boolean} isEdited - Whether this is an edited message
 * @returns {Promise<void>}
 */
async function deleteCrossChannelReply(message, env, ctx, isEdited = false) {
  const chatId = message.chat.id;
  const messageId = message.message_id;
  
  try {
    console.log(`🗑️ Deleting cross-channel reply message ${messageId} in chat ${chatId}`);
    
    // Delete the original message using our robust API function
    const deleteResult = await makeApiRequest('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    }, env);
    
    if (deleteResult !== null) {
      console.log(`✅ Successfully deleted cross-channel reply message ${messageId} in chat ${chatId}`);
      
      // Send warning message
      await sendWarningMessage(chatId, env, ctx, isEdited);
    } else {
      console.error(`❌ Failed to delete message ${messageId} in chat ${chatId}`);
      // Still send warning even if deletion failed (user should know their message violates rules)
      await sendWarningMessage(chatId, env, ctx, isEdited);
    }
    
  } catch (error) {
    console.error(`❌ Error deleting cross-channel reply message ${messageId}:`, error);
  }
}

/**
 * Send warning message with reliable auto-deletion using ctx.waitUntil
 * @param {number|string} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @param {boolean} isEdited - Whether this is for an edited message
 * @returns {Promise<void>}
 */
async function sendWarningMessage(chatId, env, ctx, isEdited = false) {
  try {
    console.log(`📨 Sending warning message to chat ${chatId}`);
    
    // Send warning message using our robust API function
    const result = await makeApiRequest('sendMessage', {
      chat_id: chatId,
      text: CONFIG.WARNING_MESSAGE_TEXT,
      parse_mode: 'HTML'
    }, env);
    
    if (result && result.message_id) {
      const warningMessageId = result.message_id;
      console.log(`✅ Sent warning message ${warningMessageId} in chat ${chatId}`);
      
      // Schedule deletion using ctx.waitUntil for reliable execution
      const deletionPromise = scheduleMessageDeletion(chatId, warningMessageId, env, CONFIG.WARNING_AUTO_DELETE_DELAY);
      ctx.waitUntil(deletionPromise);
      
    } else {
      console.error(`❌ Failed to send warning message to chat ${chatId}`);
    }
    
  } catch (error) {
    console.error(`❌ Error sending warning message to chat ${chatId}:`, error);
  }
}

/**
 * Delete warning message with improved error handling
 * @param {number|string} chatId - Telegram chat ID
 * @param {number} messageId - Message ID to delete
 * @param {Object} env - Environment variables
 * @returns {Promise<void>}
 */
async function deleteWarningMessage(chatId, messageId, env) {
  try {
    console.log(`🗑️ Auto-deleting warning message ${messageId} in chat ${chatId}`);
    
    const result = await makeApiRequest('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
    }, env);
    
    if (result !== null) {
      console.log(`✅ Successfully auto-deleted warning message ${messageId} in chat ${chatId}`);
    } else {
      // This is expected behavior - the message might have been deleted manually
      console.debug(`🔍 Warning message ${messageId} may have been already deleted in chat ${chatId}`);
    }
    
  } catch (error) {
    // Log as debug since this is often expected (manual deletion, message not found, etc.)
    console.debug(`🔍 Warning message ${messageId} deletion issue in chat ${chatId}:`, error.message);
  }
}

/**
 * Schedule message deletion using Promise-based delay with improved error handling
 * Note: While this uses setTimeout, ctx.waitUntil() ensures it completes even after response
 * @param {number|string} chatId - Telegram chat ID
 * @param {number} messageId - Message ID to delete
 * @param {Object} env - Environment variables
 * @param {number} delayMs - Delay in milliseconds before deletion
 * @returns {Promise<void>}
 */
async function scheduleMessageDeletion(chatId, messageId, env, delayMs) {
  try {
    console.log(`⏰ Scheduling deletion of message ${messageId} in ${delayMs}ms`);
    
    // Create a promise that resolves after the specified delay
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    // Delete the message
    await deleteWarningMessage(chatId, messageId, env);
  } catch (error) {
    console.error(`❌ Error in scheduled deletion for message ${messageId}:`, error);
  }
}

/**
 * Setup webhook endpoint with improved security and error handling
 * @param {Request} request - The HTTP request
 * @param {Object} env - Environment variables
 * @returns {Promise<Response>} HTTP response
 */
async function setupWebhook(request, env) {
  try {
    const url = new URL(request.url);
    const webhookUrl = `${url.protocol}//${url.host}/webhook`;
    
    console.log(`🔧 Setting up webhook to: ${webhookUrl}`);
    
    // Use our robust API request function
    const result = await makeApiRequest('setWebhook', {
      url: webhookUrl,
      allowed_updates: ['message', 'edited_message'],
      drop_pending_updates: true, // Clear any pending updates
      max_connections: 40 // Optimize for Cloudflare Workers
    }, env);
    
    if (result !== null) {
      console.log(`✅ Webhook set successfully to ${webhookUrl}`);
      return new Response(JSON.stringify({
        success: true,
        message: `Webhook set successfully to ${webhookUrl}`,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      console.error(`❌ Failed to set webhook to ${webhookUrl}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to set webhook',
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
  } catch (error) {
    console.error(`❌ Error setting webhook:`, error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
