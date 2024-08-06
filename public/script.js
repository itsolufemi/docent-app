const recordButton = document.getElementById('input-button');
const pauseButton = document.getElementById('pause-button');
const responseElement = document.getElementById('output');
const audioElement = document.getElementById('audio');
let mediaRecorder;
let audioChunks = [];
let isPlaying = false;
let audioQueue = [];
let asst_speaking = false;
let currentAudio = null;	// tacks urrent audio chunk being played

recordButton.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
    recordButton.classList.remove('active');
  } else {
    asst_speaking = false; // Reset the asst_speaking flag when starting a new recording

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

        responseElement.innerHTML = ''; // Clear the previous response
        audioQueue = []; // Clear the audio queue before the next question

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
            asst_speaking = true; // The assistant is now speaking, we are only allowed to pause
            toggle_btn(); // Show pause button and hide record button

            let chunk = decoder.decode(result.value, { stream: true });
            let lines = chunk.split('\n').filter(line => line.trim());
            for (let line of lines) {
              let parsed = JSON.parse(line);
              if (parsed.type === 'transcription') {
                responseElement.innerHTML += `<strong>Transcription:</strong> ${parsed.value.replace(/\n/g, '<br>')}<br>`;
              }
              if (parsed.type === 'audio') {
                responseElement.innerHTML += parsed.text.replace(/\n/g, '<br>');
                queueAudio(parsed.value);
              }
              if (parsed.type === 'cancelled') {
                responseElement.innerHTML = 'Cancelled.';
                audioQueue = []; // Clear the audio queue
                asst_speaking = false; // Assistant is no longer speaking, we can now record another question
                toggle_btn(); // Switch back to record button
                break;
              }
            }
          }

          asst_speaking = false; // Assistant is no longer speaking, we can now record another question
          toggle_btn(); // Switch back to record button

        } catch (error) {
          console.error('Error:', error);
          responseElement.textContent = 'Error...';
        }
      };
    });
  }
});

function toggle_btn() {
  if (asst_speaking) {
    recordButton.classList.add('hide'); // Hide the record button
    pauseButton.classList.remove('hide'); // Show the pause button
  } else {
    recordButton.classList.remove('hide'); // Show the record button
    pauseButton.classList.add('hide'); // Hide the pause button
  }
}

pauseButton.addEventListener('click', async () => {
  asst_speaking = false; // Set the speaking flag to false to stop playback
  toggle_btn(); // Switch buttons
  stopAudio(); // Stop the current audio

  try {
    const response = await fetch('/cancel-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const result = await response.json();
    console.log('Cancel result:', result);

    // Clear the audio queue
    audioQueue = [];
  } catch (error) {
    console.error('Error cancelling run:', error);
  }
});

function stopAudio() {
  if (currentAudio) {
    console.log(currentAudio);
    currentAudio.pause();
    currentAudio = null;
  }
}

function queueAudio(audioUrl) {
  audioQueue.push(audioUrl);
  if (!isPlaying) {
    playNextAudio();
  } else {
    asst_speaking = true;
  }
}

function playNextAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }

  asst_speaking = true;
  toggle_btn();

  isPlaying = true;
  const audioUrl = audioQueue.shift();
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  audio.onended = () => {
    isPlaying = false;
    playNextAudio();
  };

  audio.onerror = (error) => {
    console.error('Error with audio playback:', error);
    isPlaying = false;
    playNextAudio();
  };

  audio.play();
}
