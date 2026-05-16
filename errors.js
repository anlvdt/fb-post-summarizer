// Error Dictionary - Structured error messages with actions
// Used by background.js and content.js for consistent error handling

const ERROR_TYPES = {
  // API Key errors
  NO_API_KEY: {
    code: 'NO_API_KEY',
    message: 'Chưa có API Key',
    detail: 'Bạn cần thêm ít nhất 1 API key để sử dụng extension.',
    action: 'Mở popup → tab "Keys" → Thêm key',
    actionButton: 'Thêm Key',
    actionUrl: 'popup.html#apikeys',
    severity: 'error'
  },

  NO_AVAILABLE_KEY: {
    code: 'NO_AVAILABLE_KEY',
    message: 'Không tìm được key khả dụng',
    detail: 'Tất cả key đã bị rate limit hoặc hết quota.',
    action: 'Thêm key mới hoặc chờ reset quota',
    actionButton: 'Thêm Key',
    actionUrl: 'popup.html#apikeys',
    severity: 'warning'
  },

  // Rate limit errors
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Rate limit',
    detail: 'Key đã hết quota. Tự động thử key khác sau {countdown}s...',
    action: 'Đợi hoặc thêm key mới',
    actionButton: 'Thêm Key',
    actionUrl: 'popup.html#apikeys',
    severity: 'warning',
    retryable: true
  },

  ALL_KEYS_RATE_LIMITED: {
    code: 'ALL_KEYS_RATE_LIMITED',
    message: 'Tất cả key đều bị rate limit',
    detail: 'Quota reset vào: {resetTime}',
    action: 'Thêm key mới hoặc chờ reset',
    actionButton: 'Thêm Key',
    actionUrl: 'popup.html#apikeys',
    severity: 'error'
  },

  // Network errors
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    message: 'Lỗi kết nối',
    detail: 'Không thể kết nối đến server. Kiểm tra internet.',
    action: 'Kiểm tra kết nối và thử lại',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  },

  TIMEOUT: {
    code: 'TIMEOUT',
    message: 'Timeout',
    detail: 'Request quá lâu (>30s). Server có thể đang quá tải.',
    action: 'Thử lại sau vài giây',
    actionButton: 'Thử lại',
    severity: 'warning',
    retryable: true
  },

  // Content errors
  CONTENT_TOO_SHORT: {
    code: 'CONTENT_TOO_SHORT',
    message: 'Nội dung quá ngắn',
    detail: 'Cần ít nhất {minLength} ký tự để tóm tắt.',
    action: 'Chọn đoạn text dài hơn',
    severity: 'info'
  },

  CONTENT_TOO_LONG: {
    code: 'CONTENT_TOO_LONG',
    message: 'Nội dung quá dài',
    detail: 'Tối đa {maxLength} ký tự. Hiện tại: {currentLength} ký tự.',
    action: 'Chọn đoạn text ngắn hơn',
    severity: 'warning'
  },

  EMPTY_CONTENT: {
    code: 'EMPTY_CONTENT',
    message: 'Không có nội dung',
    detail: 'Bôi đen text trước khi tóm tắt.',
    action: 'Bôi đen text và thử lại',
    severity: 'info'
  },

  // Provider errors
  INVALID_PROVIDER: {
    code: 'INVALID_PROVIDER',
    message: 'Provider không hợp lệ',
    detail: 'Provider "{provider}" không được hỗ trợ.',
    action: 'Chọn provider khác (Auto/Groq/Gemini)',
    severity: 'error'
  },

  PROVIDER_ERROR: {
    code: 'PROVIDER_ERROR',
    message: 'Lỗi từ provider',
    detail: '{providerMessage}',
    action: 'Thử provider khác hoặc thử lại sau',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  },

  // Image errors
  IMAGE_TOO_LARGE: {
    code: 'IMAGE_TOO_LARGE',
    message: 'Ảnh quá lớn',
    detail: 'Kích thước tối đa: 12MB. Ảnh này: {size}MB.',
    action: 'Chọn ảnh nhỏ hơn',
    severity: 'warning'
  },

  IMAGE_FETCH_FAILED: {
    code: 'IMAGE_FETCH_FAILED',
    message: 'Không tải được ảnh',
    detail: 'URL ảnh không hợp lệ hoặc bị chặn.',
    action: 'Thử ảnh khác hoặc bỏ qua ảnh',
    severity: 'warning'
  },

  // Context errors
  CONTEXT_INVALIDATED: {
    code: 'CONTEXT_INVALIDATED',
    message: 'Extension đã reload',
    detail: 'Extension vừa được cập nhật hoặc reload.',
    action: 'Reload trang để tiếp tục',
    actionButton: 'Reload',
    severity: 'error'
  },

  // Generic errors
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    message: 'Lỗi không xác định',
    detail: '{errorMessage}',
    action: 'Thử lại hoặc báo lỗi cho developer',
    actionButton: 'Thử lại',
    severity: 'error',
    retryable: true
  }
};

// Helper function to create structured error
function createError(errorType, params = {}) {
  const template = ERROR_TYPES[errorType] || ERROR_TYPES.UNKNOWN_ERROR;

  // Replace placeholders in detail
  let detail = template.detail;
  Object.keys(params).forEach(key => {
    detail = detail.replace(`{${key}}`, params[key]);
  });

  return {
    code: template.code,
    message: template.message,
    detail: detail,
    action: template.action,
    actionButton: template.actionButton,
    actionUrl: template.actionUrl,
    severity: template.severity,
    retryable: template.retryable || false,
    timestamp: Date.now()
  };
}

// Export for use in background.js and content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ERROR_TYPES, createError };
}
