//App v.0.6 heroku w/ aws s3 update for audio file management, because of heroku ephemeral filesystem
// #region Imports
require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { OpenAI } = require('openai');
const openai = new OpenAI(process.env.OPENAI_API_KEY);
const app = express();
// #endregion

app.use(express.static(path.join(__dirname, '../public'))); // Serve static files from the 'public' directory
app.use(fileUpload()); // Use fileUpload middleware

const port = process.env.PORT || 3000;

app.get('/', (req, res) => { // Define a route for the root URL
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// #region To store the current thread and run ID
let threadId = null;
let runId = null;
let currentStream = null; // Store the current stream object
// #endregion

const s3 = new AWS.S3({ // Configure AWS SDK
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Endpoint to handle audio file upload and transcription
app.post('/upload', async (req, res) => {

  if (!req.files || !req.files.audio) {
    console.log('No files were uploaded.'); // Debugging line
    return res.status(400).json({ message: 'No files were uploaded.' });
  }

  const file = req.files.audio; // Ensure the key matches the client-side

  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: 'audio.wav',
    Body: file.data
  };

  try {
    await s3.upload(uploadParams).promise(); // Upload the file to S3

    // Save the file locally to a temporary path
    const tempFilePath = path.join(__dirname, 'temp_audio.wav');
    fs.writeFileSync(tempFilePath, file.data);

    // Transcribe the audio using OpenAI's Whisper API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath));
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
// features new logical error solving version of the pause.
app.post('/cancel-run', async (req, res) => {
  const runStatusResponse = await openai.beta.threads.runs.retrieve(threadId, runId);
  const runStatus = runStatusResponse.status;

  console.log('Run status:', runStatus);

  if (runStatus === 'completed') {
    res.end();
    currentStream = null;
  } else{
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