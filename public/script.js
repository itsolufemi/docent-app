//App v.0.5.2 for heroku

const recordButton = document.getElementById('input-button');
const pauseButton = document.getElementById('pause-button');
const responseElement = document.getElementById('output');
const audioElement = document.getElementById('audio');
let mediaRecorder;
let audioChunks = [];
let threadId = null;
let runId = null;
let isPaused = false;

recordButton.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
    recordButton.classList.remove('active');
  } else {
    isPaused = false; // Reset the isPaused flag when starting a new recording
    //Reset is necessary to ensure speech synthesis after pause

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      recordButton.innerHTML = '<i class="fas fa-stop"></i>';
      recordButton.classList.add('active');

      mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        audioChunks = [];
        const audioUrl = URL.createObjectURL(audioBlob);
        audioElement.src = audioUrl;

        responseElement.innerHTML = ''; // clear the previous response

        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.wav');

        try {
          const response = await fetch('/upload', {
            method: 'POST',
            body: formData
          });

          const reader = response.body.getReader();
          let decoder = new TextDecoder('utf-8');
          let result;

          while (!(result = await reader.read()).done) {
            //Switch to pause button
            recordButton.classList.add('hide'); // Hide the record button
           pauseButton.classList.remove('hide'); // Show the pause button

            let chunk = decoder.decode(result.value, { stream: true });
            let lines = chunk.split('\n').filter(line => line.trim());
            for (let line of lines) {
              let parsed = JSON.parse(line);
              if (parsed.type === 'transcription') {
                responseElement.innerHTML += `<strong>Transcription:</strong> ${parsed.value.replace(/\n/g, '<br>')}<br>`;
              }
              if (parsed.type === 'textDelta') {
                responseElement.innerHTML += parsed.value.replace(/\n/g, '<br>'); // Replaces newlines with HTML line breaks
                if (!isPaused) await speakText(parsed.value);
              }
              if (parsed.type === 'end') {
                responseElement.innerHTML += parsed.value.replace(/\n/g, '<br>'); // the last paragraph
                if (!isPaused) await speakText(parsed.value);
                // Switch back to ask button after the speech stream
                recordButton.classList.remove('hide'); // Show the record button
                pauseButton.classList.add('hide'); // Hide the pause button
              }
            }
          }
        } catch (error) {
          console.error('Error:', error);
          responseElement.textContent = 'Error processing audio';
        }
      };
    });
  }
});

pauseButton.addEventListener('click', async () => {
  isPaused = true;
  const synth = window.speechSynthesis;
  synth.cancel();

  try {
    const response = await fetch('/cancel-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ thread_id: threadId, run_id: runId })
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const result = await response.json();
    console.log('Cancel result:', result);
  } catch (error) {
    console.error('Error cancelling run:', error);
  }

  // Switch back to record button
  recordButton.classList.remove('hide'); // Show the record button
  pauseButton.classList.add('hide'); // Hide the pause button
});

function speakText(text) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; // Change this if you need a different language
    utterance.onend = resolve;
    synth.speak(utterance);
  });
}