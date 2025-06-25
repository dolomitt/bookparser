# Maintainability Guide

## Code Organization

### Current Structure
```
bookparser/
├── client/
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── constants/           # Shared constants and configuration
│   │   ├── hooks/              # Custom React hooks
│   │   ├── pages/              # Page components
│   │   ├── utils/              # Utility functions
│   │   └── ...
│   └── ...
├── server/
│   ├── index.js                # Main server file
│   ├── .env                    # Environment configuration
│   └── ...
└── MAINTAINABILITY.md         # This file
```

## Maintainability Improvements Made

### 1. Constants Extraction (`/client/src/constants/ui.js`)
- **Purpose**: Centralized UI constants to avoid magic numbers and ensure consistency
- **Benefits**: 
  - Easy to update colors, timeouts, and dimensions globally
  - Prevents inconsistencies across components
  - Makes the codebase more maintainable

**Usage Example:**
```javascript
import { COLORS, TIMEOUTS } from '../constants/ui';

// Instead of: backgroundColor: '#007bff'
backgroundColor: COLORS.primary

// Instead of: setTimeout(callback, 3000)
setTimeout(callback, TIMEOUTS.errorClear)
```

### 2. Utility Functions (`/client/src/utils/textProcessing.js`)
- **Purpose**: Extracted common text processing logic to reduce duplication
- **Benefits**:
  - Single source of truth for text processing algorithms
  - Easier to test and debug
  - Reusable across components

**Functions Available:**
- `splitIntoSentences(text)` - Japanese sentence splitting
- `isKanji(char)` - Kanji character detection
- `hasKanji(text)` - Text kanji detection
- `mapTimingsToTokens(timings, tokens)` - VOICEVOX timing mapping
- `getErrorMessage(error)` - Standardized error message formatting

### 3. Custom Hooks (`/client/src/hooks/useAudioPlayer.js`)
- **Purpose**: Encapsulated audio playback logic and state management
- **Benefits**:
  - Reusable audio functionality
  - Proper cleanup and memory management
  - Simplified component logic

**Hook Features:**
- Audio creation from base64 and blob data
- Playback state management
- Timeout scheduling and cleanup
- Automatic resource cleanup

## Recommended Future Improvements

### 1. Component Extraction
The `ImportPage.jsx` component is currently 800+ lines and should be broken down:

**Suggested Components:**
```
ImportPage/
├── ImportPage.jsx              # Main container
├── FileUpload.jsx             # File upload functionality
├── SentenceDisplay.jsx        # Sentence rendering and controls
├── TokenizedText.jsx          # Token display and interaction
├── VerbOptions.jsx            # Verb merge options panel
├── ProcessingButtons.jsx      # L/R/TTS buttons
└── TranslationPopup.jsx       # Translation popup component
```

### 2. State Management
Consider implementing a more structured state management approach:

**Options:**
- **Context API**: For sharing state between components
- **useReducer**: For complex state logic
- **Zustand/Redux**: For larger applications

### 3. Error Boundaries
Add React error boundaries for graceful error handling:

```javascript
// ErrorBoundary.jsx
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>;
    }
    return this.props.children;
  }
}
```

### 4. API Layer
Create a dedicated API service layer:

```javascript
// services/api.js
class ApiService {
  static async processText(data) {
    return axios.post('/api/parse', data);
  }

  static async generateSpeech(data) {
    return axios.post('/api/text-to-speech', data);
  }

  static async saveBook(filename, data) {
    return axios.post(`/api/import/${filename}/save`, data);
  }
}
```

### 5. Testing Structure
Implement comprehensive testing:

```
tests/
├── components/          # Component tests
├── hooks/              # Hook tests
├── utils/              # Utility function tests
├── integration/        # Integration tests
└── e2e/               # End-to-end tests
```

### 6. Performance Optimizations
- **React.memo**: Memoize expensive components
- **useMemo/useCallback**: Optimize re-renders
- **Code Splitting**: Lazy load components
- **Virtual Scrolling**: For large text files

### 7. Type Safety
Consider adding TypeScript for better maintainability:

```typescript
interface Token {
  surface: string;
  reading: string;
  pos: string;
  translation?: string;
}

interface ProcessedSentence {
  tokens: Token[];
  fullSentenceTranslation: string;
  processingType: 'local' | 'remote';
}
```

## Development Guidelines

### 1. Code Style
- Use consistent naming conventions
- Keep functions small and focused
- Add JSDoc comments for complex functions
- Use meaningful variable names

### 2. Component Guidelines
- Keep components under 200 lines
- Use custom hooks for complex logic
- Implement proper prop validation
- Handle loading and error states

### 3. Performance Guidelines
- Avoid inline object/function creation in render
- Use React DevTools Profiler to identify bottlenecks
- Implement proper memoization
- Optimize bundle size

### 4. Testing Guidelines
- Write unit tests for utility functions
- Test component behavior, not implementation
- Use integration tests for user workflows
- Maintain high test coverage

## Migration Strategy

### Phase 1: Extract Constants and Utils (✅ Completed)
- Move hardcoded values to constants
- Extract utility functions
- Create custom hooks

### Phase 2: Component Extraction
- Break down ImportPage into smaller components
- Implement proper prop interfaces
- Add error boundaries

### Phase 3: State Management
- Implement Context API or state management library
- Centralize API calls
- Add proper loading states

### Phase 4: Testing and Documentation
- Add comprehensive test suite
- Document component APIs
- Create development guidelines

## Monitoring and Maintenance

### 1. Code Quality Tools
- **ESLint**: Code linting and style enforcement
- **Prettier**: Code formatting
- **Husky**: Git hooks for quality checks
- **SonarQube**: Code quality analysis

### 2. Performance Monitoring
- **React DevTools**: Component performance
- **Lighthouse**: Web performance metrics
- **Bundle Analyzer**: Bundle size optimization

### 3. Error Tracking
- **Sentry**: Error monitoring and reporting
- **LogRocket**: Session replay and debugging

This maintainability guide should be updated as the codebase evolves and new patterns are established.
