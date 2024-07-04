//App v.0.6 heroku and aws s3 update for audio file management, because of heroku ephemeral filesystem

require('dotenv').config();

// #region Imports
const express = require('express');
const fileUpload = require('express-fileupload');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY); // Add this line for debugging

const openai = new OpenAI(process.env.OPENAI_API_KEY);
const app = express();

const port = process.env.PORT || 3000;
// #endregion

// #region To store the current thread and run ID
let threadId = null;
let runId = null;
let currentStream = null; // Store the current stream object
// #endregion

// Configure AWS SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Endpoint to handle audio file upload and transcription
app.post('/upload', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const file = req.files.sampleFile;
  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: 'audio.wav',
    Body: file.data
  };

  // Upload the file to S3
  s3.upload(uploadParams, (err, data) => {
    if (err) {
      return res.status(500).send(err);
    }

    // Save the file locally to a temporary path
    const tempFilePath = path.join(__dirname, 'temp_audio.wav');
    fs.writeFileSync(tempFilePath, file.data);

    // Transcribe the audio using Whisper API
    async function transcribeAudio() {
      try {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempFilePath),
          model: "whisper-1"
        });

        // Clean up the temporary file
        fs.unlinkSync(tempFilePath);

        // Send the transcription result
        res.send({
          message: 'File uploaded to S3 and transcribed successfully!',
          transcription: transcription.text
        });
      } catch (transcriptionError) {
        // Clean up the temporary file in case of error
        fs.unlinkSync(tempFilePath);
        res.status(500).send({
          message: 'File uploaded to S3, but failed to transcribe.',
          error: transcriptionError.message
        });
      }
    }

    transcribeAudio();
  });
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