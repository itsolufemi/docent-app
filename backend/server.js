// #region Imports
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const openai = new OpenAI(process.env.OPENAI_API_KEY);
const port = 3000;
// #endregion

// #region To store the current thread and run ID
let threadId = null;
let currentRunId = null;
// #endregion

// #region Configure multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, 'audio.wav');
  }
});

const upload = multer({ storage: storage });
const speechFile = path.resolve('./public/speech.mp3');

app.use(express.static('public'));


// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

//#endregion

// Endpoint to handle audio file upload and transcription
app.post('/upload', upload.single('audio'), async (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'audio.wav');

  try {
    // Transcribe the audio using OpenAI's Whisper API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');

    const transcriptionResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const transcriptionText = transcriptionResponse.data.text;
    console.log('Transcription Text:', transcriptionText);

    // Get assistant response and handle streaming
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    await getAssistantResponse(transcriptionText, res);

  } catch (error) {
    console.error('Error during transcription:', error.response?.data || error.message);
    res.status(500).send('Error processing audio');
  }
});

// Endpoint to handle run cancellation
app.post('/cancel-run', async (req, res) => {
  const { thread_id, run_id } = req.body;
  
  if (!thread_id || !run_id) {
    return res.status(400).json({ error: 'Missing thread_id or run_id' });
  }

  try {
    const cancelResponse = await openai.beta.threads.runs.cancel(thread_id, run_id);
    console.log('Run cancelled:', cancelResponse);
    res.json(cancelResponse);
  } catch (error) {
    console.error('Error cancelling run:', error.response?.data || error.message);
    res.status(500).send('Error cancelling run');
  }
});

// Function to interact with the Assistant
const getAssistantResponse = async (inputText, res) => {
  try {
    // Retrieve the assistant
    const assistant = await openai.beta.assistants.retrieve("asst_q9c5R2TSnZJKborszBQq24Dm");

    // Check if threadId is set, otherwise create a new thread
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    // Create the message in the existing thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: inputText
    });

    //Stream the response
    const run = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistant.id
    });
    runId = run.id;  // Save the run ID

    let assistantResponse = '';
    let buffer = '';

    run.on('textCreated', (text) => {
      //buffer += text;
    });

    run.on('textDelta', (textDelta) => {
      buffer += textDelta.value;

      // Stream the textDelta back to the client in real-time and the console
      if (buffer.includes('\n\n')) { // Consider paragraph ends as chunk delimiters
        assistantResponse += buffer;
        process.stdout.write(buffer);
        res.write(JSON.stringify({ type: 'textDelta', value: buffer }) + '\n');
        buffer = '';
      }
    });

    run.on('end', () => {
      if (buffer) {
        assistantResponse += buffer;
        res.write(JSON.stringify({ type: 'end', value: buffer }) + '\n');
      }
      //console.log('\nStreaming completed. Full Assistant Response:', assistantResponse);
      res.end(); // End the response stream
    });

  } catch (error) {
    console.error('Error interacting with Assistant:', error.response?.data || error.message);
    res.status(500).send('Error interacting with Assistant');
  }
};

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
