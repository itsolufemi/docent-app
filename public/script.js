// App v.1.0
/*UPDATE NOTES
resuming audio context state
*/  

// #region setup
const device = document.getElementById("device");
const version = "1.0.0";

const start_btn = document.getElementById('start');
const index = document.getElementById('index');
const close_btn = document.getElementById('close');
const app = document.getElementById('app');

const reg_sec = document.getElementsByClassName("button-section")[0];
const recordButton = document.getElementById('input-button');
const playButton = document.getElementById('play-button');
const pauseButton = document.getElementById('pause-button');
const play_sect = document.getElementsByClassName("mob-btn-section")[0];

const tour_btn = document.getElementById('tour-btn');
const scan_btn = document.getElementById('scan-btn');
const transcript_btn = document.getElementById('transcript-btn');
let tour_req = false;
let tour_is_selected = false;
let txt_is_selected = false;

const tour_text = document.getElementById('tour-text');
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

// #region 1. Check device type
function isMobileDevice() { // Check if the user is using a mobile device
  const userAgent = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
}

if(isMobile) {
  device.innerHTML = "mobile" + " v." + version;
} else {
  device.innerHTML = "desktop" + " v." + version;
}
// #endregion

// #region 1. start/close
start_btn.addEventListener('click', async () => {
  index.classList.add('hide'); //hide the index
  app.classList.remove('hide'); //show the app

  // #region audio contexts
  if (!audioContext) { //use the click on start as sufficient interation to initialize audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === 'suspended') { //ensure audio context is resumed
    await audioContext.resume();
  }
  // #endregion

  intro();
  show_text(); //show intro message transcription
});

close_btn.addEventListener('click', () => {
  app.classList.add('hide'); //hide the app
  index.classList.remove('hide'); //show the index
});
// #endregion

// #region 3. intro function
async function intro(){
  console.log("introduction");
  responseElement.innerHTML = '<i class="fa-solid fa-hourglass-start"></i>';
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
    const intro_res = await intro.json();
    responseElement.innerHTML = intro_res.text; // load intro text
    start_audio(intro_res.value); //start the intro message
  } catch (error) {
    console.error('Error starting intro:', error);
  };
}
// #endregion

// #region 4. mic button functions
recordButton.addEventListener('click', () => {
  if (recorder && recorder.recording) {
    recorder.stop(); // Stop the recording
    recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
    recordButton.classList.remove('active');

    show_text(); //show the transcripts panel
    responseElement.innerHTML = '<i class="fas fa-microphone"></i>';
    
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
              responseElement.innerHTML = `<strong>Transcription:</strong> ${parsed.value.replace(/\n/g, '<br>')}<br>`;
            }
            if (parsed.type === 'audio') {
              responseElement.innerHTML += parsed.text.replace(/\n/g, '<br>');
              start_audio(parsed.value);
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
// #endregion

// #region 5. menu buttons functions
tour_btn.addEventListener('click', async () => { //the tour button
  if(!tour_req) { //load tour
    tour_req = true; //confirm tour requested flag
    show_tour(); //show the tour text
    tour_text.innerHTML = '<i class="fa-solid fa-hourglass-start"></i>'; //loading ...

    // #region tour endpoint request
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
      const tour_res = await cur_tour.json();
      tour_text.innerHTML = tour_res.text;
      show_tour(); //just in case user is viewing another screen, it shows when the tour is ready to play
      start_audio(tour_res.value); //start playing the tour message
    } catch (error) {
      console.error('Error starting tour:', error);
    }
    // #endregion
  }

  if (!tour_is_selected) { //show tour text
    tour_is_selected = true;
    show_tour();
  } else {
    tour_is_selected = false;
    tour_btn.classList.remove('selected'); //remove the tour btn  selected flag
    tour_text.classList.add('hide'); //hide the tour text
  }
});

transcript_btn.addEventListener('click', () => { //the transcript button
  if (!txt_is_selected) {
    txt_is_selected = true;
    show_text();
  } else {
    txt_is_selected = false;
    transcript_btn.classList.remove('selected'); //remove the trans btn selected flag 
    responseElement.classList.add('hide'); //hide the transcription
  }
});
// #endregion

// #region 6. text functions
function show_text() {
  transcript_btn.classList.add('selected'); //change the button to selected
  responseElement.classList.remove('hide'); //show the transcription
  tour_btn.classList.remove('selected'); //remove the tour btn  selected flag
  tour_text.classList.add('hide'); //hide the tour text
  tour_is_selected = false; //negate tour option
}

function show_tour() {
  tour_btn.classList.add('selected'); //change the button to selected
  tour_text.classList.remove('hide'); //show the tour text
  transcript_btn.classList.remove('selected'); //remove the trans btn selected flag
  responseElement.classList.add('hide'); //hide the transcription
  txt_is_selected = false; //negate transcript option
}
// #endregion

// #region audio  functions
/* function mob_compat() { //mobile compatibility autoplay circumvent
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
} */

function start_audio(x) { //play assistant response
  queueAudio(x); //autoplay assistant response
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
    isPlaying = false;
    end_res();
}

function queueAudio(audioUrl) { //add all the audio to the queue
  audioQueue.push(audioUrl);
  if (!isPlaying) {
    playNextAudio();
  }
}

/* mob compact function
function mob_queueAudio(audioUrl) { //(mobile) add all the audio to the queue
  audioQueue.push(audioUrl);
} */

function playNextAudio() { //play next audio in the queue
  if ( audioQueue.length === 0) {//once there are no more audio to play
    audio_triggerred = false;
    console.log('\nNo more audio to play');
    isPlaying = false;
    end_res();
    return;
  }
  
  isPlaying = true; //set audio to is playing...
  const audioUrl = audioQueue.shift();
  const audio = document.getElementById('preloaded-audio'); // Use preloaded audio element
  audio.src = audioUrl;
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

  audio.play().catch((error) => {
    console.error('Playback failed:', error);
  });
}

function end_res() { // at the end of the assistant audio response
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
// #endregion