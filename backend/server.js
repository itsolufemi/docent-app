//App v.0.7.1 implementing open ai audio tts api, client side
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
app.use(express.json()); // to parse JSON bodies for the TTs endpoint.


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
  isCancelled = false; //reset the cancellation flag

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
    const tempFilePath = path.join(__dirname, '/public/audios/temp_audio.wav');
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
let isCancelled = false; //its not cancelled until it is cancelled... lol

app.post('/cancel-run', async (req, res) => {
  isCancelled = true; // Set the cancellation flag
  try {
    const runStatusResponse = await openai.beta.threads.runs.retrieve(threadId, runId);
    const runStatus = runStatusResponse.status;

    if (runStatus === 'completed') {
      console.log('Run already completed');
      currentStream = null;
      res.status(200).json({ message: 'Run already completed' });
    } else{
      const cancelResponse = await openai.beta.threads.runs.cancel(threadId, runId);
      console.log('Run aborted: ', cancelResponse.status);
      //return res.status(200).json({ message: 'Run aborted' });
      currentStream = null;
      res.status(200).json({ message: 'Run aborted', status: cancelResponse.status });
    }
  } catch (error) {
    console.error('Error cancelling run:', error);
    res.status(500).json({ message: 'Error cancelling run', error: error.message });
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
    
    // Send the transcription text to the client first
    res.write(JSON.stringify({ type: 'transcription', value: inputText }) + '\n');

    for await (const event of stream) {
      if (isCancelled) { // Check for cancellation
        console.log('Stream cancelled by user');
        res.write(JSON.stringify({ type: 'cancelled' }) + '\n');
        res.end();
        isCancelled = false; // Reset the cancellation flag
        break;
      }

      if (event.event === 'thread.run.created') {
        runId = event.data.id;
      }

      if (event.event === 'thread.message.delta') {
        const contentArray = event.data.delta.content;

        if (Array.isArray(contentArray)) {
          buffer += contentArray.map(item => item.text.value).join('');
        }

        if (buffer.includes('\n\n')) {
          // Call TTS endpoint with the current chunk
          const speechurl = await generateTTS(buffer); //call the audio tts endpoint

          assistantResponse += buffer;
          process.stdout.write(buffer);
          res.write(JSON.stringify({  type: 'audio', text: buffer, value: speechurl }) + '\n');
          buffer = '';
        }
      }

      if (event.event === 'thread.run.completed') {
        if (buffer) {
          // Call TTS endpoint with the end chunk
          const speechurl = await generateTTS(buffer); //call the audio tts endpoint

          assistantResponse += buffer;
          res.write(JSON.stringify({type: 'audio', text: buffer, value: speechurl }) + '\n');
        }
        res.end();
        currentStream = null;
        break;
      }
    }
  } catch (error) {
    console.error('Error interacting with Assistant:', error.response?.data || error.message);
    res.status(500).send('Error interacting with Assistant');
  }
};

  // Endpoint to handle TTS requests
  const generateTTS = async (text) => {
    try {
      const response = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: text
      });
      const bufferData = Buffer.from(await response.arrayBuffer());
      const speechFile = `speech_${Date.now()}.mp3`;
      const speechFilePath = path.join(__dirname, `../public/audios`, speechFile);
      await fs.promises.writeFile(speechFilePath, bufferData);
      return `/audios/${speechFile}`;
    } catch (error) {
      console.error('Error generating TTS:', error);
      throw new Error('Error generating TTS');
    }
  };

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});