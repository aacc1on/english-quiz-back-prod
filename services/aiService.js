const axios = require('axios');
require('dotenv').config();

async function generateQuizFromText(text) {
  console.log('[AI_SERVICE] Quiz generation started');
  console.log(`[AI_SERVICE] Input text length: ${text ? text.length : 0} characters`);
  
  // ✅ Validate input
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    console.log('[AI_SERVICE] ❌ Input validation failed');
    throw new Error('Input text must be a meaningful string (at least 20 characters)');
  }

  // ✅ Check API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  console.log(`[AI_SERVICE] API Key status: ${apiKey ? 'SET' : '❌ NOT SET'}`);
  
  if (!apiKey) {
    console.log('[AI_SERVICE] ❌ API key missing from environment');
    throw new Error('API key is not configured. Please set OPENROUTER_API_KEY in your .env file.');
  }

  // Log API key format (safely)
  if (apiKey) {
    console.log(`[AI_SERVICE] API Key format: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})`);
  }

  // ✅ Prompt for the model
  const prompt = `
Generate 10 quiz questions based on the following text. For each question, pick a difficult English word from the text or related vocabulary, and provide:
- "word": the difficult word,
- "question": "Which of the following is the closest easier synonym for 'word'?",
- "options": 4 English options (one correct, three distractors),
- "correct": the correct easier synonym (must be one of the options).

Text: "${text.substring(0, 1000)}"

Return only valid JSON in this format:
{
  "quiz": [
    {
      "word": "example",
      "question": "Which of the following is the closest easier synonym for 'example'?",
      "options": ["instance", "difficult", "complex", "impossible"],
      "correct": "instance"
    }
  ]
}
`;

  console.log('[AI_SERVICE] Prompt prepared, sending request to OpenRouter...');

  try {
    const requestPayload = {
      model: "mistralai/mistral-7b-instruct:free",
      messages: [
        { role: "system", content: "You are a precise quiz generator that outputs perfect JSON. Always respond with valid JSON only." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    };

    console.log('[AI_SERVICE] Request payload:', JSON.stringify(requestPayload, null, 2));

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      requestPayload,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5000',
          'X-Title': 'English Quiz Generator'
        },
        timeout: 30000
      }
    );

    console.log('[AI_SERVICE] ✅ Received response from OpenRouter');
    console.log('[AI_SERVICE] Response status:', response.status);
    console.log('[AI_SERVICE] Response headers:', JSON.stringify(response.headers, null, 2));

    // ✅ Extract and parse content
    const content = response.data.choices?.[0]?.message?.content;
    console.log('[AI_SERVICE] Raw model response:');
    console.log('================================');
    console.log(content);
    console.log('================================');

    if (!content) {
      console.log('[AI_SERVICE] ❌ No content in response');
      console.log('[AI_SERVICE] Full response data:', JSON.stringify(response.data, null, 2));
      throw new Error('No content received from AI model');
    }

    let quizObj;
    try {
      // Try to parse the content directly
      quizObj = JSON.parse(content);
      console.log('[AI_SERVICE] ✅ Successfully parsed JSON directly');
    } catch (e) {
      console.log('[AI_SERVICE] ⚠️ Direct JSON parse failed, trying to extract JSON block');
      console.log('[AI_SERVICE] Parse error:', e.message);
      
      // Try to extract JSON from markdown code block
      let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        // Try to extract any JSON-like structure
        jsonMatch = content.match(/{[\s\S]*}/);
      }
      
      if (!jsonMatch) {
        console.log('[AI_SERVICE] ❌ No JSON structure found in response');
        throw new Error("No JSON object found in model response. Raw content: " + content.substring(0, 200));
      }
      
      try {
        quizObj = JSON.parse(jsonMatch[0]);
        console.log('[AI_SERVICE] ✅ Successfully extracted and parsed JSON');
      } catch (e2) {
        console.log('[AI_SERVICE] ❌ Failed to parse extracted JSON');
        console.log('[AI_SERVICE] Extracted content:', jsonMatch[0]);
        throw new Error(`Failed to parse extracted JSON: ${e2.message}`);
      }
    }

    console.log('[AI_SERVICE] Parsed quiz object:', JSON.stringify(quizObj, null, 2));

    // ✅ Validate quiz structure
    if (!quizObj.quiz || !Array.isArray(quizObj.quiz)) {
      console.log('[AI_SERVICE] ❌ Invalid quiz format - missing quiz array');
      console.log('[AI_SERVICE] Quiz object keys:', Object.keys(quizObj));
      throw new Error('Invalid quiz format returned by model - missing quiz array');
    }

    if (quizObj.quiz.length === 0) {
      console.log('[AI_SERVICE] ❌ Quiz array is empty');
      throw new Error('Quiz array is empty');
    }

    // Validate each question
    for (let i = 0; i < quizObj.quiz.length; i++) {
      const q = quizObj.quiz[i];
      console.log(`[AI_SERVICE] Validating question ${i + 1}:`, JSON.stringify(q, null, 2));
      
      if (!q.word || !q.question || !q.options || !q.correct) {
        console.log(`[AI_SERVICE] ❌ Question ${i + 1} missing required fields`);
        throw new Error(`Question ${i + 1} is missing required fields`);
      }
      
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        console.log(`[AI_SERVICE] ❌ Question ${i + 1} options invalid`);
        throw new Error(`Question ${i + 1} must have exactly 4 options`);
      }
      
      if (!q.options.includes(q.correct)) {
        console.log(`[AI_SERVICE] ❌ Question ${i + 1} correct answer not in options`);
        throw new Error(`Question ${i + 1} correct answer "${q.correct}" not found in options`);
      }
    }

    console.log(`[AI_SERVICE] ✅ Successfully generated and validated ${quizObj.quiz.length} questions`);
    return quizObj.quiz;

  } catch (err) {
    console.error('[AI_SERVICE] ❌ Error occurred:', err.message);
    console.error('[AI_SERVICE] Full error object:', err);
    
    if (err.response) {
      console.error('[AI_SERVICE] API Response Status:', err.response.status);
      console.error('[AI_SERVICE] API Response Headers:', JSON.stringify(err.response.headers, null, 2));
      console.error('[AI_SERVICE] API Response Data:', JSON.stringify(err.response.data, null, 2));
      
      // Handle specific API errors
      if (err.response.status === 401) {
        throw new Error('API authentication failed. Please check your OPENROUTER_API_KEY.');
      } else if (err.response.status === 429) {
        throw new Error('API rate limit exceeded. Please try again later.');
      } else if (err.response.status === 400) {
        throw new Error(`API request invalid: ${err.response.data.error?.message || 'Bad request'}`);
      }
    } else if (err.request) {
      console.error('[AI_SERVICE] No response received from API');
      console.error('[AI_SERVICE] Request details:', err.request);
      throw new Error('No response received from AI service. Please check your internet connection.');
    }

    // ✅ Handle known error types
    if (err.code === 'ECONNABORTED') {
      throw new Error('API request timed out. Please try again later.');
    } else if (err.message.includes('API key')) {
      throw err;
    } else if (err.message.includes('JSON')) {
      throw err;
    } else {
      throw new Error(`Failed to generate quiz: ${err.message}`);
    }
  }
}

module.exports = { generateQuizFromText };