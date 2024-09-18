// App v.0.9
/*UPDATE NOTES
  tour functionality
*/  

// #region setup
const tour_btn = document.getElementById('tour-btn');
const tour_text = document.getElementById('tour-text');
const tour_panel = document.getElementsByClassName('tour-sec');
const device = document.getElementById("device");
const play_sect = document.getElementsByClassName("mob-btn-section")[0];
const reg_sec = document.getElementsByClassName("button-section")[0];
const playButton = document.getElementById('play-button');
const recordButton = document.getElementById('input-button');
const pauseButton = document.getElementById('pause-button');
const responseElement = document.getElementById('output');
const audioElement = document.getElementById('audio');
let audioContext;
let recorder;
let audio_triggerred = false;
let isPlaying = false;
let audioQueue = [];
let asst_speaking = false;
let currentAudio = null;	// tracks current audio chunk being played
const isMobile = isMobileDevice(); // Check if the user is on a mobile device at the start
// #endregion

intro();

function isMobileDevice() { // Check if the user is using a mobile device
  const userAgent = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
}

if(isMobile) {
  device.innerHTML = "Mobile";
} else {
  device.innerHTML = "Desktop";
}

// #region introduction
async function intro(){
  console.log("introduction");
  try {
    const intro = await fetch('/introduction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    if (!intro.ok) {
      throw new Error('Network response was not ok');
    }
    const result = await intro.json();
    responseElement.innerHTML = result.text;
    if(isMobile){
      mob_queueAudio(result.value); //queue each new audio chunk
      mob_compat();
    }  else {
      queueAudio(result.value); //autoplay assistant response
    }
  } catch (error) {
    console.error('Error starting intro:', error);
  };
}

// #endregion

// #region tour feature
tour_btn.addEventListener('click', async () => {
  try {
    const cur_tour = await fetch('/tour', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!cur_tour.ok) {
      throw new Error('Network response was not ok');
    }
    const result = await cur_tour.json();
    tour_text.innerHTML = result.text;
    if(isMobile){
      mob_queueAudio(result.value); //queue each new audio chunk
      mob_compat();
    }  else {
      queueAudio(result.value); //autoplay assistant response
    }
  } catch (error) {
    console.error('Error starting tour:', error);
  }
});

// #endregion


recordButton.addEventListener('click', () => {
  if (recorder && recorder.recording) {
    recorder.stop(); // Stop the recording
    recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
    recordButton.classList.remove('active');
    
    recorder.exportWAV(async (blob) => {
      const audioUrl = URL.createObjectURL(blob);
      audioElement.src = audioUrl;

      responseElement.innerHTML = ''; // Clear the previous response
      audioQueue = []; // Clear the audio queue before the next question

      const formData = new FormData();
      formData.append('audio', blob, 'audio.wav');

      try {
        const response = await fetch('/upload', {
          method: 'POST',
          body: formData
        });

        const reader = response.body.getReader();
        let decoder = new TextDecoder('utf-8');
        let result;
        
        asst_speaking = true; // The assistant is now speaking, we are only allowed to pause
        toggle_btn(); // Show pause button and hide record button

        while (!(result = await reader.read()).done) {
          if (!asst_speaking) { // Check if the assistant is speaking before processing more audio
            console.log("Cancelling further audio processing.");
            audioQueue = []; // Clear the audio queue if the assistant is no longer speaking
            break; // Exit the loop if the assistant is no longer speaking
          }

          let chunk = decoder.decode(result.value, { stream: true });
          let lines = chunk.split('\n').filter(line => line.trim());
          for (let line of lines) {
            let parsed = JSON.parse(line);
            if (parsed.type === 'transcription') {
              responseElement.innerHTML += `<strong>Transcription:</strong> ${parsed.value.replace(/\n/g, '<br>')}<br>`;
            }
            if (parsed.type === 'audio') {
              responseElement.innerHTML += parsed.text.replace(/\n/g, '<br>');
              if(isMobile){
                mob_queueAudio(parsed.value); //queue each new audio chunk
                mob_compat();
              }  else {
                queueAudio(parsed.value); //autoplay assistant response
              }
            }
            if (parsed.type === 'cancelled') {
              responseElement.innerHTML = 'Cancelled.';
              break;
            }
          }
        }
      } catch (error) {
        console.error('Error:', error);
        responseElement.textContent = 'Error...';
      }
    });

  } else {
    //asst_speaking = false; // Reset the asst_speaking flag when starting a new recording

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const input = audioContext.createMediaStreamSource(stream);
      recorder = new Recorder(input, { numChannels: 1 });
      recorder.record();
      recordButton.innerHTML = '<i class="fas fa-stop"></i>';
      recordButton.classList.add('active');
    }).catch(error => {
      console.error('Error accessing media devices:', error);
      responseElement.textContent = 'Error accessing media devices: ' + error.message;
    });
  }
});

// #region mobile compatibility autoplay circumvent
function mob_compat() {
  if (!audio_triggerred){
    console.log("mobile device");
    play_sect.classList.remove('hide'); // Show play button section
    reg_sec.classList.add('hide');  // Hide regular button section 
    playButton.onclick = () => {
      audio_triggerred = true;
      play_sect.classList.add('hide'); // Hide play button section
      reg_sec.classList.remove('hide'); // Show regular button section
      playNextAudio(); // Ensure that all queued audios play sequent
    }
  };
}
// #endregion

function toggle_btn() {
  console.log("buttons have switched");
  if (asst_speaking) { //assistant is currently speaking
    recordButton.classList.add('hide'); // Hide the record button
    pauseButton.classList.remove('hide'); // Show the pause button
  } else { //assistant is not currently speaking
    recordButton.classList.remove('hide'); // Show the record button
    pauseButton.classList.add('hide'); // Hide the pause button
  }
}

pauseButton.addEventListener('click', async () => {
  asst_speaking = false; // Set the speaking flag to false to stop playback
  audioQueue = []; // Clear the audio queue
  audio_triggerred = false; // Reset audio trigger flag
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
  } catch (error) {
    console.error('Error cancelling run:', error);
  }
});

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
    isPlaying = false;
    end_res();

}

function queueAudio(audioUrl) {
  audioQueue.push(audioUrl);
  if (!isPlaying) {
    playNextAudio();
  }
}

function mob_queueAudio(audioUrl) {
  audioQueue.push(audioUrl); //add all the audio to the queue
}

function playNextAudio() {
  if ( audioQueue.length === 0) {//once there are no more audio to play
    audio_triggerred = false;
    console.log('\nNo more audio to play');
    isPlaying = false;
    end_res();
    return;
  }
  
  isPlaying = true; //set audio to is playing...
  const audioUrl = audioQueue.shift();
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  audio.onended = () => { //when one audio chunk ends play the next
    console.log('Audio ended');
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

function end_res() {
  asst_speaking = false;
  toggle_btn();
  
  console.log(`
    stream ends
    isPlaying: ${isPlaying} 
    asst_speaking: ${asst_speaking} 
    currentAudio: ${currentAudio}
    audioQueue: ${audioQueue}
    audio_triggerred: ${audio_triggerred}
   `);
  return;
}