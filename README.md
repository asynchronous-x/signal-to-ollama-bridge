# Signal to Ollama Bridge

A minimal Express.js server that bridges the Signal REST API with the Ollama REST API. This bridge periodically polls the Signal API for new messages, processes them with an Ollama language model, and sends responses back to the original sender.

## Features

- Periodically polls Signal API for new messages
- Processes messages with Ollama API
- Sends Ollama's responses back to the original Signal sender
- Configurable via environment variables
- Tracks message timestamps to avoid processing duplicates
- Automatically strips model thinking (content within `<think>` tags) from responses
- Dynamic response length control: varies the token limit for diverse responses
- Variable response patterns: sometimes responds twice, sometimes skips responding, sometimes just sends emoji reactions
- Emoji reactions: periodically reacts to messages with random emojis
- Complete conversation tracking: maintains context of both user messages and bot responses

## Prerequisites

- Node.js (v14 or higher)
- Signal REST API service running
- Ollama REST API service running

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/signal-to-ollama-bridge.git
   cd signal-to-ollama-bridge
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables by editing the `.env` file:
   ```
   PORT=3000
   SIGNAL_API_URL=http://localhost:8080
   OLLAMA_API_URL=http://localhost:11434
   OLLAMA_MODEL=llama3
   SIGNAL_PHONE_NUMBER=+1234567890
   POLLING_INTERVAL=10000
   # For group chats, use the group ID. For multiple recipients, separate with commas
   SIGNAL_RECIPIENTS=group.AbCdEfGhIjKlMnOpQrStUvWxYz
   # Optional: Set this to only process messages from a specific group chat
   WATCH_GROUP_ID=group.AbCdEfGhIjKlMnOpQrStUvWxYz
   ```

## Usage

1. Start the server:
   ```
   node server.js
   ```
   or
   ```
   npm start
   ```

2. The server will automatically start polling the Signal API for new messages at the configured interval.

3. When new messages are received, they will be processed by Ollama, and the responses will be sent back to the original sender.

## API Endpoints

- `GET /`: Health check endpoint

## Signal API Integration

The bridge polls the Signal API using the `/v1/receive/{number}` endpoint to check for new messages. It keeps track of the timestamp of the last processed message to avoid processing duplicates.

## Ollama API Integration

The bridge forwards messages to Ollama using the `/api/chat` endpoint with the following format:

```json
{
  "model": "llama3",
  "options": {
    "num_predict": 25
  },
  "messages": [
    { "role": "system", "content": "System prompt here" },
    { "role": "user", "content": "Hello, how are you?" }
  ],
  "stream": false
}
```

### Response Processing

The bridge processes Ollama's responses in several ways to ensure clean, natural communication:

1. **Thinking Process Removal**: Removes any content enclosed in `<think>` tags. This is useful for models that include their reasoning or internal thought processes within these tags. For example, if the model responds with:

   ```
   Let me think about this... <think>I should consider what time of day it is and provide a context-appropriate greeting.</think> Hello! How can I help you today?
   ```

   The bridge will only send `Let me think about this... Hello! How can I help you today?` back to Signal.

2. **Name Reference Removal**: Strips out any instances of the form "[Name]" or "[Name]:" from responses to prevent the bot from impersonating users or creating confusion in group chats.

These processing steps ensure that only the final, clean response reaches the users without any meta-content or potentially confusing name references.

### Dynamic Response Length

The bridge implements a token variation system that dynamically changes the `num_predict` parameter:

- Most messages use a value between 15-35 tokens, resulting in concise responses
- Every 10-20 messages, the value increases to 140-200 tokens, allowing for more detailed, comprehensive responses

This variation creates a more natural conversation pattern with a mix of short responses and occasional longer, more detailed explanations. The exact timing of longer responses is randomized to maintain a natural feel to the conversation.

### Selective Responses

To create more natural group chat behavior, the bridge occasionally chooses not to respond to messages:

- Every 6-10 messages, the bridge will deliberately skip sending a response
- These skipped messages are still added to the conversation context
- This makes the bot feel less robotic and more like a natural participant in a group conversation

By not responding to every message, the bot creates a more realistic communication pattern where it appears to be "listening" to some messages without feeling the need to comment on everything.

### Variable Response Patterns

The bridge implements several response patterns that make the bot's behavior more dynamic and human-like:

1. **No Response**: Sometimes the bot will deliberately not respond to a message, creating a more natural flow where it doesn't comment on everything.

2. **Single Response**: The standard behavior where the bot responds once to a user message.

3. **Double Response**: Occasionally (every 8-16 messages), the bot will send two separate responses in succession with a small delay between them (500-2000ms). This mimics how humans sometimes follow up with additional thoughts or clarifications.

4. **Emoji Reactions**: Instead of text responses, the bot sometimes reacts to messages with emoji reactions like ❤️, 👍, ☠️, 😂, or 💀.

5. **Short Message Handling**: Messages less than 5 characters are stored in conversation history but never receive a text response. There's a 50% chance these short messages will receive an emoji reaction instead. This mimics how humans often acknowledge brief utterances with a simple reaction rather than a full response.

These variable patterns make the bot's behavior less predictable and more engaging, creating a more authentic conversational experience.

### Emoji Reactions

The bridge also occasionally responds with emoji reactions instead of text responses:

- Every 10-20 messages, the bridge will react to a message with a randomly selected emoji
- The bridge uses a diverse set of common emojis like 👍, ❤️, 😂, 💀, etc.
- When sending an emoji reaction, the bridge won't send a text response to that message

This feature makes the bot's behavior more human-like and engaging in group conversations, as it mimics how people often use quick reactions instead of typing out full responses.

### Conversation History Tracking

The bridge maintains a complete history of the conversation, including:

- User messages with sender identification
- Bot's own responses
- Proper role assignment for LLM context building

This comprehensive conversation tracking allows the bot to:

1. **Maintain context awareness** across multiple messages
2. **Reference its previous responses** for more coherent conversations
3. **Create a natural flow** by understanding the full conversation history

The system sends the last 10 messages (5 conversation turns) to the language model with each request, allowing it to maintain continuity while keeping context windows manageable.

## Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Port for the Express server | 3000 |
| SIGNAL_API_URL | URL of the Signal REST API | http://localhost:8080 |
| OLLAMA_API_URL | URL of the Ollama REST API | http://localhost:11434 |
| OLLAMA_MODEL | Ollama model to use for generating responses | llama3 |
| SIGNAL_PHONE_NUMBER | Phone number to use for receiving messages | (Required) |
| POLLING_INTERVAL | Interval in milliseconds between polls | 10000 (10 seconds) |
| SIGNAL_RECIPIENTS | Comma-separated list of recipients or a group ID | (Uses original sender if not specified) |
| WATCH_GROUP_ID | Group ID to filter incoming messages by | (Processes all messages if not specified) |

## Group Chat Support

To use this bridge with a Signal group chat:

1. Set `SIGNAL_PHONE_NUMBER` to your Signal phone number
2. Set `SIGNAL_RECIPIENTS` to your group ID (e.g., `group.AbCdEfGhIjKlMnOpQrStUvWxYz`)
3. Optionally, set `WATCH_GROUP_ID` to the same group ID to only process messages from that group

You can also specify multiple individual recipients by separating them with commas:
```
SIGNAL_RECIPIENTS=+1234567890,+0987654321
```

### Filtering Messages by Group

If you only want to process messages from a specific group chat, set the `WATCH_GROUP_ID` environment variable. Messages from other groups or direct messages will be ignored.
