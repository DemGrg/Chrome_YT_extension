document.addEventListener('DOMContentLoaded', function() {
  const saveKeyButton = document.getElementById('save-key');
  const askButton = document.getElementById('ask-question');
  const downloadButton = document.getElementById('download-json');
  const apiKeyInput = document.getElementById('api-key');
  const questionInput = document.getElementById('question');
  const resultDiv = document.getElementById('result');
  const modelSelect = document.getElementById('model-select');
  const temperatureInput = document.getElementById('temperature');
  const copyButton = document.getElementById('copy-result');
  const clearJsonButton = document.getElementById('clear-json');

  // Load saved API key
  chrome.storage.local.get(['openai_api_key'], function(result) {
    if (result.openai_api_key) {
      apiKeyInput.value = result.openai_api_key;
    }
  });

  // Save API key
  saveKeyButton.addEventListener('click', function() {
    const apiKey = apiKeyInput.value;
    chrome.storage.local.set({openai_api_key: apiKey}, function() {
      console.log('API key saved locally');
    });
  });

  // Ask question
  askButton.addEventListener('click', () => {
    resultDiv.textContent = "Fetching transcript...";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: fetchTranscript
        }, (results) => {
            if (results && results[0] && results[0].result) {
                const transcript = results[0].result;
                if (transcript !== 'Transcript elements not found' && transcript !== 'Show transcript button not found') {
                    resultDiv.textContent = "Transcript fetched. Sending to OpenAI...";
                    const question = questionInput.value;
                    const selectedModel = modelSelect.value;
                    const temperature = parseFloat(temperatureInput.value);
                    askOpenAI(question, transcript, selectedModel, temperature);
                } else {
                    resultDiv.textContent = 'Transcript not found. Make sure you are on a YouTube video page with available transcripts.';
                }
            } else {
                resultDiv.textContent = 'Error fetching transcript. Please try again.';
            }
        });
    });
});

  function askOpenAI(question, transcript, model, temperature) {
      chrome.storage.local.get(['openai_api_key'], function(result) {
        if (!result.openai_api_key) {
          resultDiv.textContent = "Please save your OpenAI API key first.";
          return;
        }
  
        resultDiv.textContent = "Loading...";

        // If question is empty, set it to "None"
        const userQuestion = question.trim() === '' ? 'None' : question;

        const charLimit = model === 'gpt-3.5-turbo' ? 10000 : 100000;

        let truncatedContent;
        if (transcript.length > charLimit) {
          truncatedContent = transcript.substring(0, charLimit) + "... (content truncated)";
          resultDiv.textContent = `Transcript exceeded ${charLimit} characters and was truncated. Processing...`;
        } else {
          truncatedContent = transcript;
        }
  
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${result.openai_api_key}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                "role": "system",
                "content": "You are a helpful and precise summary assistant. Analyze the given YouTube transcript and provide the following:\n1. A short, precise title for the video (max 10 words)\n2. A brief precise overall summary in 1-2 sentences\n3. Precise bullet point summaries for every 10 minutes of content, focusing on key insights and notions. Highlight specific points, comparisons, and important data from the text(e.g., Spacecraft A is the fastest, Spacecraft B is the sturdiest). Extract key insights and facts. \n4.User's question\n5. An answer to the user's question with key facts extracted from the transcript.\n\nFormat your response using these exact headings: Title:, Overall Summary:, 10-Minute Summaries:,User Question:, Question Answer:"
            },
            {
                "role": "user",
                "content": `YouTube Transcript:\n${transcript}\n\nQuestion: ${userQuestion}`
            }
            ],
            temperature: temperature
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.choices && data.choices.length > 0) {
            const answer = data.choices[0].message.content;
            resultDiv.textContent = answer;
            
            storeData(question, answer, truncatedContent, model, temperature);
            copyButton.disabled = false;
          } else {
            resultDiv.textContent = "Sorry, I couldn't generate an answer.";
            copyButton.disabled = true;
          }
        })
        .catch(error => {
          resultDiv.textContent = "An error occurred: " + error.message;
        });
      });
  }
  
  function storeData(question, answer, truncatedContent, model, temperature) {
      chrome.storage.local.get(['storedData'], function(result) {
        let storedData = result.storedData || [];
        storedData.push({
          timestamp: new Date().toISOString(),
          model: model,
          temperature: temperature,
          question: question,
          answer: answer,
          youtubeTranscript: truncatedContent
        });
        chrome.storage.local.set({storedData: storedData}, function() {
          console.log('Data stored');
        });
      });
  }
    
  // Download JSON
  downloadButton.addEventListener('click', function() {
      chrome.storage.local.get(['storedData'], function(result) {
        const dataStr = JSON.stringify(result.storedData || [], null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = 'youtube_transcript_data.json';
    
        let linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
      });
  });

  // Copy result
  copyButton.addEventListener('click', function() {
      const textToCopy = resultDiv.textContent;
      navigator.clipboard.writeText(textToCopy).then(function() {
        console.log('Text copied to clipboard');
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      }).catch(function(err) {
        console.error('Could not copy text: ', err);
      });
  });

  // Clear JSON data
  clearJsonButton.addEventListener('click', function() {
      chrome.storage.local.remove('storedData', function() {
          console.log('Stored data cleared');
          alert('JSON data has been cleared.');
      });
  });

  // Initially disable the copy button
  copyButton.disabled = true;
});

function fetchTranscript() {
  function clickTranscriptButton() {
      const showTranscriptButton = document.querySelector("#primary-button > ytd-button-renderer > yt-button-shape > button > yt-touch-feedback-shape > div > div.yt-spec-touch-feedback-shape__fill");
      if (showTranscriptButton) {
          showTranscriptButton.click();
          return new Promise(resolve => setTimeout(() => resolve(getTranscriptText()), 3000)); // Increased wait time
      } else {
          return Promise.resolve('Show transcript button not found');
      }
  }

  function getTranscriptText() {
      // Try different selectors to find transcript elements
      const selectors = [
          'ytd-transcript-segment-renderer',
          '.ytd-transcript-segment-renderer',
          'yt-formatted-string.segment-text',
          '.segment-text'
      ];

      for (let selector of selectors) {
          const transcriptElements = document.querySelectorAll(selector);
          if (transcriptElements.length > 0) {
              let transcript = '';
              transcriptElements.forEach(element => {
                  transcript += element.textContent + ' ';
              });
              return transcript.trim();
          }
      }

      return 'Transcript elements not found';
  }

  // Check if transcript is already open
  const transcriptContainer = document.querySelector('ytd-transcript-renderer');
  if (transcriptContainer) {
      return getTranscriptText();
  } else {
      return clickTranscriptButton().then(result => {
          if (result === 'Transcript elements not found') {
              // If transcript not found after clicking, try one more time
              return new Promise(resolve => setTimeout(() => resolve(getTranscriptText()), 2000));
          }
          return result;
      });
  }
}