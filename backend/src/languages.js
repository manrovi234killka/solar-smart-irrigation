// Languages the farmer can pick from the keypad menu at the start of a call.
// `speech` is the Twilio <Gather> speech-recognition language, `voice` the Twilio <Say> voice.
// Voices can be overridden from .env (VOICE_EN, VOICE_HI, ...) if Twilio renames them.

export const LANGUAGES = {
  en: {
    digit: "1",
    name: "English",
    speech: "en-IN",
    voice: process.env.VOICE_EN || "Google.en-IN-Standard-A",
    menu: "For English, press 1.",
    greeting:
      "Hello! I am your farm assistant. You can say: turn the pump on, turn the pump off, or ask about soil moisture. How can I help?",
    again: "Anything else?",
    notHeard: "Sorry, I did not hear you. Please say it again.",
    wait: "One moment.",
    error: "Sorry, something went wrong. Please try again.",
    goodbye: "Goodbye!",
  },
  hi: {
    digit: "2",
    name: "Hindi",
    speech: "hi-IN",
    voice: process.env.VOICE_HI || "Google.hi-IN-Standard-A",
    menu: "हिंदी के लिए 2 दबाएं।",
    greeting:
      "नमस्ते! मैं आपका खेत सहायक हूँ। आप कह सकते हैं: पंप चालू करो, पंप बंद करो, या मिट्टी की नमी पूछ सकते हैं। मैं आपकी क्या मदद करूँ?",
    again: "और कुछ?",
    notHeard: "माफ़ कीजिए, मुझे सुनाई नहीं दिया। कृपया फिर से बोलिए।",
    wait: "एक क्षण रुकिए।",
    error: "माफ़ कीजिए, कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।",
    goodbye: "धन्यवाद, नमस्ते!",
  },
  te: {
    digit: "3",
    name: "Telugu",
    speech: "te-IN",
    voice: process.env.VOICE_TE || "Google.te-IN-Standard-A",
    menu: "తెలుగు కోసం 3 నొక్కండి.",
    greeting:
      "నమస్కారం! నేను మీ పొలం సహాయకుడిని. మీరు చెప్పవచ్చు: పంపు ఆన్ చేయి, పంపు ఆఫ్ చేయి, లేదా మట్టి తేమ ఎంత అని అడగవచ్చు. నేను ఎలా సహాయం చేయగలను?",
    again: "ఇంకా ఏమైనా?",
    notHeard: "క్షమించండి, నాకు వినిపించలేదు. దయచేసి మళ్ళీ చెప్పండి.",
    wait: "ఒక్క క్షణం.",
    error: "క్షమించండి, ఏదో సమస్య వచ్చింది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
    goodbye: "ధన్యవాదాలు, సెలవు!",
  },
  ta: {
    digit: "4",
    name: "Tamil",
    speech: "ta-IN",
    voice: process.env.VOICE_TA || "Google.ta-IN-Standard-A",
    menu: "தமிழுக்கு 4 ஐ அழுத்தவும்.",
    greeting:
      "வணக்கம்! நான் உங்கள் வயல் உதவியாளர். நீங்கள் சொல்லலாம்: பம்பை ஆன் செய், பம்பை ஆஃப் செய், அல்லது மண் ஈரப்பதம் எவ்வளவு என்று கேட்கலாம். நான் எப்படி உதவலாம்?",
    again: "வேறு ஏதாவது?",
    notHeard: "மன்னிக்கவும், எனக்கு கேட்கவில்லை. தயவுசெய்து மீண்டும் சொல்லுங்கள்.",
    wait: "ஒரு நிமிடம்.",
    error: "மன்னிக்கவும், ஏதோ பிழை ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.",
    goodbye: "நன்றி, வணக்கம்!",
  },
  kn: {
    digit: "5",
    name: "Kannada",
    speech: "kn-IN",
    voice: process.env.VOICE_KN || "Google.kn-IN-Standard-A",
    menu: "ಕನ್ನಡಕ್ಕಾಗಿ 5 ಒತ್ತಿರಿ.",
    greeting:
      "ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಹೊಲದ ಸಹಾಯಕ. ನೀವು ಹೇಳಬಹುದು: ಪಂಪ್ ಆನ್ ಮಾಡು, ಪಂಪ್ ಆಫ್ ಮಾಡು, ಅಥವಾ ಮಣ್ಣಿನ ತೇವಾಂಶ ಎಷ್ಟು ಎಂದು ಕೇಳಬಹುದು. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
    again: "ಇನ್ನೇನಾದರೂ?",
    notHeard: "ಕ್ಷಮಿಸಿ, ನನಗೆ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.",
    wait: "ಒಂದು ಕ್ಷಣ.",
    error: "ಕ್ಷಮಿಸಿ, ಏನೋ ತೊಂದರೆಯಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    goodbye: "ಧನ್ಯವಾದಗಳು, ಹೋಗಿ ಬನ್ನಿ!",
  },
};

export const DEFAULT_LANG = "en";

export function langByDigit(digit) {
  return Object.keys(LANGUAGES).find((code) => LANGUAGES[code].digit === digit);
}

export function lang(code) {
  return LANGUAGES[code] || LANGUAGES[DEFAULT_LANG];
}

// Words that help speech recognition pick up farm vocabulary (English and common loanwords).
export const SPEECH_HINTS =
  "pump, motor, on, off, start, stop, soil moisture, moisture, water level, tank, battery, solar, voltage, temperature, minutes, status";
