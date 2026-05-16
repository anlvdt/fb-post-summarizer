// Setup Wizard Logic
let currentStep = 0;
const totalSteps = 4;

// DOM Elements
const progressDots = document.querySelectorAll('.wizard-progress-dot');
const steps = document.querySelectorAll('.wizard-step');

// Step 0 (Welcome)
const step0Next = document.getElementById('step0Next');

// Step 1 (API Key)
const step1Back = document.getElementById('step1Back');
const step1Next = document.getElementById('step1Next');
const step1Skip = document.getElementById('step1Skip');
const wizardApiKey = document.getElementById('wizardApiKey');
const wizardKeyStatus = document.getElementById('wizardKeyStatus');

// Step 2 (Settings)
const step2Back = document.getElementById('step2Back');
const step2Next = document.getElementById('step2Next');
const wizardOutputLanguage = document.getElementById('wizardOutputLanguage');
const wizardSummaryLength = document.getElementById('wizardSummaryLength');
const wizardHideAffiliate = document.getElementById('wizardHideAffiliate');

// Step 3 (Complete)
const step3Finish = document.getElementById('step3Finish');

// Navigation Functions
function goToStep(stepIndex) {
  if (stepIndex < 0 || stepIndex >= totalSteps) return;

  // Update current step
  currentStep = stepIndex;

  // Update progress dots
  progressDots.forEach((dot, index) => {
    dot.classList.remove('active', 'completed');
    if (index < currentStep) {
      dot.classList.add('completed');
    } else if (index === currentStep) {
      dot.classList.add('active');
    }
  });

  // Update step visibility
  steps.forEach((step, index) => {
    step.classList.remove('active');
    if (index === currentStep) {
      step.classList.add('active');
    }
  });
}

function nextStep() {
  goToStep(currentStep + 1);
}

function prevStep() {
  goToStep(currentStep - 1);
}

// Status Display
function showStatus(message, type) {
  wizardKeyStatus.textContent = message;
  wizardKeyStatus.className = `status ${type}`;
  wizardKeyStatus.style.display = 'block';
}

function hideStatus() {
  wizardKeyStatus.style.display = 'none';
}

// API Key Detection
function detectProvider(key) {
  if (!key) return null;

  const trimmed = key.trim();
  if (trimmed.startsWith('gsk_')) return 'groq';
  if (trimmed.startsWith('AIza')) return 'gemini';
  if (trimmed.startsWith('csk-')) return 'cerebras';
  if (trimmed.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) return 'sambanova';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';

  return null;
}

// Save API Key
async function saveApiKey(key) {
  const provider = detectProvider(key);
  if (!provider) {
    showStatus('❌ Key không hợp lệ. Vui lòng kiểm tra lại.', 'error');
    return false;
  }

  try {
    // Get existing keys
    const data = await chrome.storage.local.get('apiKeys');
    const apiKeys = data.apiKeys || {};

    // Initialize provider array if not exists
    if (!apiKeys[provider]) {
      apiKeys[provider] = [];
    }

    // Check if key already exists
    const keyExists = apiKeys[provider].some(k => k.key === key);
    if (keyExists) {
      showStatus('⚠️ Key này đã tồn tại', 'info');
      return true;
    }

    // Add new key
    apiKeys[provider].push({
      key: key,
      status: 'active',
      addedAt: Date.now()
    });

    // Save to storage
    await chrome.storage.local.set({ apiKeys });

    showStatus(`✓ Đã thêm ${provider.toUpperCase()} key`, 'success');
    return true;
  } catch (error) {
    console.error('Error saving API key:', error);
    showStatus('❌ Lỗi khi lưu key. Vui lòng thử lại.', 'error');
    return false;
  }
}

// Save Settings
async function saveSettings() {
  const settings = {
    outputLanguage: wizardOutputLanguage.value,
    summaryLength: wizardSummaryLength.value,
    hideAffiliatePosts: wizardHideAffiliate.checked,
    languageAutoDetected: true,
    minLength: 400,
    promptStyle: 'default',
    customInstructions: '',
    customSummaryPrompt: '',
    customAffPrompt: '',
    sourceTemplate: '• Nguồn bài viết: {platform} {author} {source}\n  {link}',
    useHeuristicEval: false,
    adDisplayMode: 'collapse',
    affiliateDisplayMode: 'collapse',
    blockedDomains: '',
    theme: 'auto'
  };

  try {
    await chrome.storage.sync.set(settings);
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Mark wizard as completed
async function completeWizard() {
  try {
    await chrome.storage.local.set({ wizardCompleted: true });
    return true;
  } catch (error) {
    console.error('Error marking wizard as completed:', error);
    return false;
  }
}

// Event Listeners

// Step 0: Welcome
step0Next.addEventListener('click', () => {
  nextStep();
});

// Step 1: API Key
step1Back.addEventListener('click', () => {
  prevStep();
});

step1Next.addEventListener('click', async () => {
  const key = wizardApiKey.value.trim();

  if (!key) {
    showStatus('⚠️ Vui lòng nhập API key', 'info');
    return;
  }

  const saved = await saveApiKey(key);
  if (saved) {
    setTimeout(() => {
      nextStep();
    }, 1000);
  }
});

step1Skip.addEventListener('click', () => {
  nextStep();
});

// Auto-hide status when typing
wizardApiKey.addEventListener('input', () => {
  hideStatus();
});

// Step 2: Settings
step2Back.addEventListener('click', () => {
  prevStep();
});

step2Next.addEventListener('click', async () => {
  const saved = await saveSettings();
  if (saved) {
    nextStep();
  }
});

// Step 3: Complete
step3Finish.addEventListener('click', async () => {
  await completeWizard();

  // Close wizard and open popup
  window.close();
  chrome.action.openPopup();
});

// Load saved settings (if any)
async function loadSavedSettings() {
  try {
    const data = await chrome.storage.sync.get([
      'outputLanguage',
      'summaryLength',
      'hideAffiliatePosts'
    ]);

    if (data.outputLanguage) {
      wizardOutputLanguage.value = data.outputLanguage;
    }
    if (data.summaryLength) {
      wizardSummaryLength.value = data.summaryLength;
    }
    if (data.hideAffiliatePosts !== undefined) {
      wizardHideAffiliate.checked = data.hideAffiliatePosts;
    }
  } catch (error) {
    console.error('Error loading saved settings:', error);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  goToStep(0);
});
