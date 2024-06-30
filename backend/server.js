//App v.0.5.2 for heroku

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
const port = process.env.PORT || 3000;
// #endregion

// Ensure 'uploads' directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// #region To store the current thread and run ID
let threadId = null;
let runId = null;
let currentStream = null; // Store the current stream object
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
// #endregion

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

  const runStatusResponse = await openai.beta.threads.runs.retrieve(threadId, runId);
  const runStatus = runStatusResponse.status;

  if (runStatus !== 'completed') {
    //more needs to be done to resolve this logical issue

    //currentStream.abort();
    const cancelResponse = await openai.beta.threads.runs.cancel(threadId, runId);
    console.log('Run aborted: ', cancelResponse.status);
    return res.status(200).json({ message: 'Run aborted' });
  }
});

// Function to interact with the Assistant
const getAssistantResponse = async (inputText, res) => {
  try {
    // Retrieve the assistant
    const assistant = await openai.beta.assistants.retrieve("asst_e3phU73yAZIBbIdsmuRYsCHS");

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

    // Create and stream the run response
    const stream = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistant.id,
      stream: true
    });

    // Store the current stream object
    currentStream = stream;

    let assistantResponse = '';
    let buffer = '';

    for await (const event of stream) {
      if (event.event === 'thread.run.created') {
        runId = event.data.id;
      }

      if (event.event === 'thread.message.delta') {
        const contentArray = event.data.delta.content;

        if (Array.isArray(contentArray)) {
          buffer += contentArray.map(item => item.text.value).join('');
        }

        if (buffer.includes('\n\n')) {
          assistantResponse += buffer;
          process.stdout.write(buffer);
          res.write(JSON.stringify({ type: 'textDelta', value: buffer }) + '\n');
          buffer = '';
        }
      }

      if (event.event === 'thread.run.completed') {
        if (buffer) {
          assistantResponse += buffer;
          res.write(JSON.stringify({ type: 'end', value: buffer }) + '\n');
        }
        res.end();
        currentStream = null;
        break;
      }
    }

    //console.log('Assistant Response:', assistantResponse);

  } catch (error) {
    console.error('Error interacting with Assistant:', error.response?.data || error.message);
    res.status(500).send('Error interacting with Assistant');
  }
};

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});