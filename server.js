const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Configuration
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:8080';
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';
const SIGNAL_PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER || '';
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL || '10000', 10); // Default: 10 seconds
const SIGNAL_RECIPIENTS = process.env.SIGNAL_RECIPIENTS ? process.env.SIGNAL_RECIPIENTS.split(',') : [];
const WATCH_GROUP_NAME = process.env.WATCH_GROUP_NAME || ''; // Group ID to watch for messages
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || '';

// File path for storing conversation history
const HISTORY_FILE_PATH = './conversationHistory.json';

// Store the timestamp of the last processed message
let lastProcessedTimestamp = Date.now();
// Array to store conversation history with role information
let conversationHistory = [];
// Counter to track message processing for num_predict variation
let messageCounter = 0;
// Counter to help determine when to skip a response
let lastSkippedMessageCounter = 0;
// Counter to track when the last emoji reaction was sent
let lastEmojiReactionCounter = 0;
// Counter to track when the last double response was sent
let lastDoubleResponseCounter = 0;

// Array of emojis for reactions
const emojis = ["❤️", "👍", "☠️", "😂", "💀"];

// Variable to track if the bot is currently responding
let isResponding = true;

// Persistent variable to store the current send interval
let currentSendInterval = getRandomNumber(2, 5);

// Function to get a random number between min and max (inclusive)
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to get a random emoji from the array
function getRandomEmoji() {
  const randomIndex = Math.floor(Math.random() * emojis.length);
  return emojis[randomIndex];
}

// Function to determine if we should skip responding to this message
function shouldSkipResponse() {
  // Check if enough messages have passed since the last skip
  const messagesSinceLastSkip = messageCounter - lastSkippedMessageCounter;

  if (messagesSinceLastSkip >= currentSendInterval) {
    lastSkippedMessageCounter = messageCounter;
    console.log(`Sending response for message #${messageCounter} (send interval: ${currentSendInterval})`);
    // Recalculate the send interval for the next cycle
    currentSendInterval = getRandomNumber(2, 5);
    return false; // Do not skip, send the message
  }

  console.log(`Skipping response for message #${messageCounter} (current send interval: ${currentSendInterval})`);
  return true; // Skip the message
}

// Function to determine if we should send an emoji reaction
function shouldSendEmojiReaction() {
  // Determine the interval for emoji reactions (every 10-20 messages)
  const emojiInterval = getRandomNumber(3, 7);

  // Check if enough messages have passed since the last emoji reaction
  const messagesSinceLastEmoji = messageCounter - lastEmojiReactionCounter;

  if (messagesSinceLastEmoji >= emojiInterval) {
    lastEmojiReactionCounter = messageCounter;
    const emoji = getRandomEmoji();
    console.log(`Sending emoji reaction ${emoji} for message #${messageCounter} (emoji interval: ${emojiInterval})`);
    return emoji;
  }

  return null;
}

// Function to determine if we should send a second response
function shouldSendSecondResponse() {
  // Determine the interval for double responses (every 8-16 messages)
  const doubleResponseInterval = getRandomNumber(2, 8);
  
  // Check if enough messages have passed since the last double response
  const messagesSinceLastDouble = messageCounter - lastDoubleResponseCounter;
  
  if (messagesSinceLastDouble >= doubleResponseInterval) {
    lastDoubleResponseCounter = messageCounter;
    console.log(`Will send a second response for message #${messageCounter} (double response interval: ${doubleResponseInterval})`);
    return true;
  }
  
  return false;
}

// Function to determine num_predict value based on message length
function getNumPredict(messageLength) {
  // Base scaling factor for num_predict
  const baseFactor = 0.5;
  // Calculate base num_predict based on message length
  let baseNumPredict = Math.floor(messageLength * baseFactor);

  // Ensure baseNumPredict is within a reasonable range
  baseNumPredict = Math.max(10, Math.min(baseNumPredict, 150));

  // Add randomness to the num_predict value
  const randomAdjustment = getRandomNumber(-5, 5);
  const numPredict = baseNumPredict + randomAdjustment;

  console.log(`Calculated num_predict value: ${numPredict} (message length: ${messageLength}, base: ${baseNumPredict}, adjustment: ${randomAdjustment})`);

  return numPredict;
}

// Helper function to check and regenerate incomplete responses
async function ensureCompleteResponse(sender, numPredict, conversationHistory, aiResponse) {
  // Check if the response ends in an incomplete sentence
  const incompleteSentencePattern = /\b(and|or|but|so|because|if|when|while|although|though|since|unless|until|where|whether|before|after|once|as|than|that|which|who|whom|whose|what|where|when|why|how|is|are|was|were|has|have|had|do|does|did|can|could|shall|should|will|would|may|might|must|ought|need|dare|used|to|for|with|at|by|from|in|on|of|about|as|into|like|through|after|over|between|out|against|during|without|before|under|around|among|to|for|with|at|by|from|in|on|of|about|as|into|like|through|after|over|between|out|against|during|without|before|under|around|among)\s*$/i;
  if (!/[.!?]$/.test(aiResponse) || incompleteSentencePattern.test(aiResponse)) {
    console.log(`Response seems incomplete, reprocessing through LLM.`);
    // Reprocess the message through the LLM
    const ollamaResponse = await axios.post(`${OLLAMA_API_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      options: {
        num_predict: numPredict,
      },
      messages: [
        {
          "role": "system",
          "content": SYSTEM_PROMPT
        },
        // Include the last 10 conversation turns (5 exchanges)
        ...conversationHistory.slice(-10),
        {
          "role": "assistant",
          "content": aiResponse
        }
      ],
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OLLAMA_API_TOKEN}`
      }
    });

    // Extract the new response
    let newAiResponse = ollamaResponse.data.message.content;
    newAiResponse = newAiResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
    newAiResponse = newAiResponse.replace(/<think>[\s\S]*/g, '');
    newAiResponse = newAiResponse.trim();

    console.log(`Reprocessed Ollama response: ${newAiResponse}`);

    // Append the new response to the old one
    aiResponse += ' ' + newAiResponse;

    // Recursively ensure the response is complete
    return ensureCompleteResponse(sender, numPredict, conversationHistory, aiResponse);
  }

  return aiResponse;
}

// Routes
app.get('/', (req, res) => {
  res.send('Signal to Ollama Bridge Server is running');
});

// Function to process a single message
async function processMessage(message) {
  try {
    const attachments = message.envelope?.dataMessage?.attachments;
    const quote = message.envelope?.dataMessage?.quote;
    const mentions = message.envelope?.dataMessage?.mentions;

    // Check if quote is present and doesn't quote us
    if (quote && Object.keys(quote).length > 0 && quote.authorNumber !== SIGNAL_PHONE_NUMBER) {
      console.log(`Message contains a quote not to us. Storing message and rolling for random reaction.`);
      
      // Store the message in conversation history
      conversationHistory.push({
        role: "user",
        content: message.envelope?.dataMessage?.message
      });

      // Execute random reaction logic
      const emojiReaction = shouldSendEmojiReaction();
      if (emojiReaction) {
        await sendSignalReaction(message.envelope.source, emojiReaction, message.envelope.dataMessage.timestamp);
        console.log(`Sent emoji reaction ${emojiReaction} to message with quote from ${message.envelope.sourceName}`);
      }

      // Update timestamp and return without responding
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, message.envelope.timestamp);
      return;
    }

    // Check if @ is present and doesn't @ us
    if (mentions && Object.keys(mentions[0]).length > 0 && mentions[0].number !== SIGNAL_PHONE_NUMBER) {
      console.log(`Message contains an @ not to us. Storing message and rolling for random reaction.`);
      
      // Store the message in conversation history
      conversationHistory.push({
        role: "user",
        content: message.envelope?.dataMessage?.message
      });

      // Execute random reaction logic
      const emojiReaction = shouldSendEmojiReaction();
      if (emojiReaction) {
        await sendSignalReaction(message.envelope.source, emojiReaction, message.envelope.dataMessage.timestamp);
        console.log(`Sent emoji reaction ${emojiReaction} to message with quote from ${message.envelope.sourceName}`);
      }

      // Update timestamp and return without responding
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, message.envelope.timestamp);
      return;
    }

    // Check if attachments are present and react with a thumbs-up emoji with 50% chance
    if (attachments && attachments.length > 0) {
      if (Math.random() < 0.5) {
        const thumbsUpEmoji = '👍';
        await sendSignalReaction(message.envelope.source, thumbsUpEmoji, message.envelope.dataMessage.timestamp);
        console.log(`Reacted with thumbs-up emoji to message with attachments from ${message.envelope.sourceName}`);
      } else {
        console.log(`No emoji reaction for message with attachments from ${message.envelope.sourceName} (coin flip)`);
      }
      return; // end early
    }

    const sender = message.envelope.source;
    const senderName = message.envelope.sourceName;
    if (!message.envelope?.dataMessage)
      return
    if (message.envelope?.dataMessage.reaction)
      return
    const messageText = `[${senderName}] ${message.envelope?.dataMessage?.message}`;
    const originalMessageText = message.envelope?.dataMessage?.message || '';
    const timestamp = message.envelope.timestamp;
    const groupName = message.envelope.dataMessage.groupInfo?.groupName || ''

    // Skip if we're watching a specific group and this message is not from that group
    if (WATCH_GROUP_NAME && groupName !== WATCH_GROUP_NAME) {
      console.log(`Skipping message from ${senderName} - not from watched group ${WATCH_GROUP_NAME}`);
      return;
    }

    console.log(`Processing message from ${senderName}${groupName ? ' in group ' + groupName : ''}: ${messageText}`);

    // Increment message counter
    messageCounter++;

    // Add the user message to conversation history
    conversationHistory.push({
      role: "user",
      content: messageText
    });

    // Check if message is very short (less than 5 characters)
    if (originalMessageText.trim().length < 5) {
      console.log(`Message is very short (${originalMessageText.length} chars). Storing in history but not responding.`);
      
      // 50% chance to add an emoji reaction to short messages
      if (Math.random() < 0.5) {
        const shortMsgEmoji = getRandomEmoji();
        await sendSignalReaction(sender, shortMsgEmoji, message.envelope.dataMessage.timestamp);
        console.log(`Applied random emoji reaction ${shortMsgEmoji} to short message`);
      } else {
        console.log(`No emoji reaction for this short message (coin flip)`);
      }
      
      // Update timestamp and return without responding
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, timestamp);
      return;
    }

    // Check if the message content is 'Wendy' to toggle responding state
    if (originalMessageText.trim() === 'Wendy') {
      isResponding = !isResponding;
      console.log(`Responding state toggled. Now responding: ${isResponding}`);
      // Update timestamp and return without further processing
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, timestamp);
      return;
    }

    // Check if the bot is currently responding
    if (!isResponding) {
      console.log('Bot is not responding to messages currently.');
      // Update timestamp and return without responding
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, timestamp);
      return;
    }

    // Determine response behavior
    // 1. Check if we should just send an emoji reaction
    const emojiReaction = shouldSendEmojiReaction();
    
    if (emojiReaction) {
      // Send emoji reaction to the message
      await sendSignalReaction(sender, emojiReaction, message.envelope.dataMessage.timestamp);
      console.log(`Sent emoji reaction ${emojiReaction} to message from ${senderName}`);
    }
    
    // 2. Check if we should skip responding entirely
    const skipResponse = shouldSkipResponse();
    if (skipResponse) {
      console.log(`Deliberately not responding to message #${messageCounter} but adding to context history`);
      // Always update last processed timestamp
      lastProcessedTimestamp = Math.max(lastProcessedTimestamp, timestamp);
      saveConversationHistory();
      return; // Exit early after deciding to skip
    }
    
    // 3. Send a regular response
    // Get dynamic num_predict value
    const numPredict = getNumPredict(originalMessageText.length);

    // Send message to Ollama API
    let ollamaResponse = await axios.post(`${OLLAMA_API_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      options: {
        num_predict: numPredict,
      },
      messages: [
        {
          "role": "system",
          "content": SYSTEM_PROMPT
        },
        // Include the last 10 conversation turns (5 exchanges)
        ...conversationHistory.slice(-10)
      ],
      stream: false
    });

    // Extract response from Ollama
    let aiResponse = ollamaResponse.data.message.content;
    aiResponse = aiResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
    aiResponse = aiResponse.replace(/<think>[\s\S]*/g, '');
    aiResponse = aiResponse.trim();

    console.log(`Ollama response (after stripping <think> tags and name references): ${aiResponse}`);

    // Ensure the response is complete
    aiResponse = await ensureCompleteResponse(sender, numPredict, conversationHistory, aiResponse);

    // Send response back to Signal
    aiResponse && await sendSignalMessage(sender, aiResponse);
    
    // Add the assistant's response to conversation history
    conversationHistory.push({
      role: "assistant",
      content: aiResponse
    });

    // Save conversation history after processing each message
    saveConversationHistory();

    console.log(`Message processed successfully. Last timestamp: ${lastProcessedTimestamp}`);
    
    // 4. Check if we should send a second response
    const sendSecondResponse = shouldSendSecondResponse();
    
    if (sendSecondResponse) {
      console.log(`Preparing to send a second response for message #${messageCounter}`);
      
      // Small delay between messages to make it feel more natural (500-2000ms)
      const delay = getRandomNumber(500, 2000);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Get a potentially different num_predict value for variety
      const secondNumPredict = getNumPredict(originalMessageText.length);
      
      // Send second message to Ollama API with updated context
      const secondOllamaResponse = await axios.post(`${OLLAMA_API_URL}/api/chat`, {
        model: OLLAMA_MODEL,
        options: {
          num_predict: secondNumPredict,
        },
        messages: [
          {
            "role": "system",
            "content": SYSTEM_PROMPT
          },
          // Include the last 10 conversation turns (5 exchanges) plus the first response
          ...conversationHistory.slice(-10)
        ],
        stream: false
      });
      
      // Extract second response from Ollama
      let secondAiResponse = secondOllamaResponse.data.message.content;
      secondAiResponse = secondAiResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
      secondAiResponse = secondAiResponse.replace(/<think>[\s\S]*/g, '');
      secondAiResponse = secondAiResponse.trim();
      
      console.log(`Second Ollama response: ${secondAiResponse}`);
      
      // Send second response back to Signal
      secondAiResponse && await sendSignalMessage(sender, secondAiResponse);
      
      // Add the assistant's second response to conversation history
      conversationHistory.push({
        role: "assistant",
        content: secondAiResponse
      });
      
      console.log(`Second message processed successfully.`);
    }

    // Always update last processed timestamp
    lastProcessedTimestamp = Math.max(lastProcessedTimestamp, timestamp);
    
    // Log the updated conversation history
    console.log(`Conversation history (last ${Math.min(conversationHistory.length, 5)} messages):`);
    conversationHistory.slice(-5).forEach((msg, idx) => {
      console.log(`  [${idx + 1}] ${msg.role}: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

// Function to poll for new messages
async function pollSignalMessages() {
  try {
    if (!SIGNAL_PHONE_NUMBER) {
      console.error('SIGNAL_PHONE_NUMBER not configured in .env file');
      return;
    }

    // console.log(`Polling for new messages since ${new Date(lastProcessedTimestamp).toISOString()}`);

    const response = await axios.get(`${SIGNAL_API_URL}/v1/receive/${SIGNAL_PHONE_NUMBER}?max_messages=10`);

    if (response.data && Array.isArray(response.data)) {
      if (response.data.length > 0) console.log(`Received ${response.data.length} messages from Signal API`);

      // Sort messages by timestamp to process them in order
      const sortedMessages = response.data.sort((a, b) => a.envelope.timestamp - b.envelope.timestamp);

      // Process each message
      for (const message of sortedMessages) {
        await processMessage(message);
      }
    }
  } catch (error) {
    console.error('Error polling Signal API:', error);
  } finally {
    // Schedule next poll
    setTimeout(pollSignalMessages, POLLING_INTERVAL);
  }
}

// Function to send a message via Signal API
async function sendSignalMessage(recipient, message) {
  try {
    // Use the configured recipients list if available, otherwise use the original recipient
    const recipients = SIGNAL_RECIPIENTS.length > 0 ? SIGNAL_RECIPIENTS : [recipient];

    const response = await axios.post(`${SIGNAL_API_URL}/v2/send`, {
      message,
      number: SIGNAL_PHONE_NUMBER, // Use the configured phone number as sender
      recipients: recipients
    });

    console.log(`Message sent to recipients [${recipients.join(', ')}]:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`Failed to send message to recipients [${SIGNAL_RECIPIENTS.join(', ') || recipient}]:`, error);
    throw error;
  }
}

// Function to send a reaction via Signal API
async function sendSignalReaction(recipient, emoji, targetTimestamp) {
  try {
    // Use the configured recipients list if available, otherwise use the original recipient
    const recipients = SIGNAL_RECIPIENTS.length > 0 ? SIGNAL_RECIPIENTS : [recipient];

    const response = await axios.post(`${SIGNAL_API_URL}/v1/reactions/${SIGNAL_PHONE_NUMBER}`, {
      reaction: emoji,
      recipient: recipients[0],
      target_author: recipient,
      timestamp: targetTimestamp,
    });

    console.log(`Emoji reaction ${emoji} sent to message from ${recipient}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`Failed to send emoji reaction to ${recipient}:`, error);
    throw error;
  }
}

// Function to save conversation history to a file
function saveConversationHistory() {
  fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(conversationHistory, null, 2));
  console.log('Conversation history saved to file.');
}

// Function to load conversation history from a file
function loadConversationHistory() {
  if (fs.existsSync(HISTORY_FILE_PATH)) {
    const data = fs.readFileSync(HISTORY_FILE_PATH);
    conversationHistory = JSON.parse(data);
    console.log('Conversation history loaded from file.');
  } else {
    console.log('No existing conversation history file found. Starting fresh.');
  }
}

// Load conversation history at startup
loadConversationHistory();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Signal API URL: ${SIGNAL_API_URL}`);
  console.log(`Ollama API URL: ${OLLAMA_API_URL}`);
  console.log(`Using Ollama model: ${OLLAMA_MODEL}`);
  console.log(`Polling Signal API every ${POLLING_INTERVAL}ms`);
  console.log(`Signal recipients: ${SIGNAL_RECIPIENTS.length > 0 ? SIGNAL_RECIPIENTS.join(', ') : 'Using original sender'}`);
  if (WATCH_GROUP_NAME) {
    console.log(`Watching for messages from group: ${WATCH_GROUP_NAME}`);
  } else {
    console.log('Processing messages from all chats and groups');
  }

  // Start polling for messages
  pollSignalMessages();
}); 