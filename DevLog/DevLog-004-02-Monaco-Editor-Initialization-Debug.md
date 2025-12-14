# DevLog 004-02: Monaco Editor Initialization Debug

**Date**: 2025-12-14  
**Branch**: `editor-examples`  
**Issue**: Monaco Editor fails to initialize with `TypeError: Cannot read properties of null (reading 'parentNode')`

## Problem Statement

After adding new features (ExampleSelector, file upload, clear code button) to the code editor, Monaco Editor consistently fails to initialize with:

```
Failed to load Monaco Editor: TypeError: Cannot read properties of null (reading 'parentNode')
    at getShadowRoot (monaco-editor internals)
    at isInShadowDOM (monaco-editor internals)
    at StandaloneThemeService.registerEditorContainer (monaco-editor internals)
    at new StandaloneEditor2 (monaco-editor internals)
    at monaco.editor.create(editorContainer, ...)
```

**Critical Observation**: Code execution still works properly, reading from `editorStore.code`, which means the store is functioning but the Monaco editor UI fails to initialize.

## Architecture Context

### Dual CodeEditor Instances
EditorLayout renders TWO separate `<CodeEditor>` components:
- **Mobile layout** (line 384): Inside `.code-panel` with conditional `.hidden` class
- **Desktop layout** (line 397): Inside `.left-panel`

Both instances exist in DOM simultaneously, controlled by `{#if isMobile}...{:else}` block. This structure existed in main branch and worked fine.

### Code Execution Flow
1. User types in Monaco editor
2. Monaco's `onDidChangeModelContent` → `editorStore.setCode()`
3. Execution reads from `$editorStore.code` (NOT from editor instance)
4. This explains why execution works even when Monaco fails to initialize

## Debug Attempts and Results

### Attempt 1: Add visibility checks and retry logic
**Approach**: Check if container is visible, retry with intervals, poll for DOM readiness  
**Result**: FAILED - Same error  
**Issue**: Overcomplicated, added unnecessary complexity

### Attempt 2: Simple 100ms delay
**Approach**: `await new Promise(resolve => setTimeout(resolve, 100))`  
**Result**: FAILED - Same error

### Attempt 3: Increase delay to 150ms
**Result**: FAILED - Same error

### Attempt 4: Check container visibility with `getComputedStyle`
**Approach**: Wait until `window.getComputedStyle(editorContainer).display !== 'none'`  
**Result**: FAILED - Same error

### Attempt 5: Revert to main branch code
**Approach**: Restore exact main branch CodeEditor.svelte (no delays, no checks)  
**Result**: FAILED - Same error  
**Conclusion**: The new EditorLayout changes (header, ExampleSelector, etc.) are causing the issue, not CodeEditor changes

### Attempt 6: Add Monaco initialization guard
**Approach**: Check `$editorStore.monacoLoaded` to prevent duplicate initialization  
**Result**: FAILED - Same error

### Attempt 7: Increase delay to 2000ms (2 seconds)
**Result**: FAILED - Same error  
**Conclusion**: NOT a timing issue

### Attempt 8: Check if container exists
**Approach**: Verify `editorContainer` and `editorContainer.parentNode` before Monaco init  
**Result**: Found root cause - `editorContainer` is **null**  
**Discovery**: `bind:this={editorContainer}` hasn't executed when `onMount` runs in Svelte 5

### Attempt 9: Wait for bind:this completion
**Approach**: Poll until `editorContainer` exists and has `parentNode`  
**Result**: FAILED - Same error at `monaco.editor.create()`  
**Issue**: Container exists but Monaco's internal `getShadowRoot` still finds null `parentNode`

### Attempt 10: Use document.body.contains()
**Approach**: Wait until `document.body.contains(editorContainer)` returns true  
**Result**: FAILED - Same error  
**Conclusion**: Container is in document, but DOM is being manipulated WHILE Monaco initializes

## Current Understanding

### What We Know
1. `editorContainer` binding completes asynchronously in Svelte 5
2. `document.body.contains(editorContainer)` returns true before Monaco init
3. Monaco's `getShadowRoot` traverses parent chain and finds null `parentNode` somewhere
4. This happens consistently, not intermittently
5. Main branch had same dual-instance structure and worked fine
6. Code execution works (store-based), only Monaco UI fails

### What Changed
Comparing `main` vs `editor-examples` branch in EditorLayout:
- Added ExampleSelector component
- Added file upload button
- Added clear code button
- Added ConfirmModal component
- Added header-left wrapper div around title
- Added example-controls div

### Hypothesis
The additional DOM elements in the header or the new components are causing a structural change that breaks Monaco's parent chain traversal. Monaco's `getShadowRoot` function expects a stable DOM tree, but something in the new layout causes a node in the parent chain to have `parentNode === null` during initialization.

## Next Steps to Investigate

1. **Compare DOM structure**: Inspect actual DOM tree in main vs editor-examples when editor opens
2. **Test without new components**: Temporarily remove ExampleSelector, file upload, clear buttons to isolate
3. **Check CSS**: Verify if new `.header-left` or `.example-controls` divs have display/positioning that affects DOM
4. **Monaco source**: Examine what `getShadowRoot` actually does and why it fails
5. **Defer Monaco init**: Try initializing Monaco in `$effect` instead of `onMount`
6. **Single instance**: Force only ONE CodeEditor to render (remove dual mobile/desktop instances)

## Questions

1. Why did main branch work with dual instances but editor-examples doesn't?
2. What specific DOM change breaks Monaco's parent chain traversal?
3. Is there a Monaco configuration option to make it more resilient to DOM manipulation?
4. Should we refactor to single CodeEditor instance with CSS-based show/hide?

---

## ROOT CAUSE IDENTIFIED

### The Real Problem: Dual Instance Architecture

**Question:** Why have TWO CodeEditor instances for mobile and desktop?

**Answer:** There's NO architectural reason. It's just how it was implemented.

The `{#if isMobile}...{:else}` block creates completely different DOM structures with duplicate `<CodeEditor>` components:
- Mobile: `<CodeEditor>` inside `.code-panel`
- Desktop: `<CodeEditor>` inside `.left-panel`

**Why This Breaks:**
1. Svelte 5's `{#if}...{:else}` creates/destroys DOM branches
2. Both instances try to initialize Monaco simultaneously
3. Monaco's `getShadowRoot()` traverses parent chain during initialization
4. DOM manipulation during Monaco init causes `parentNode === null` errors
5. The `monacoLoaded` guard doesn't prevent race conditions

**Why Main Branch Worked:**
Main had the same dual-instance structure BUT simpler DOM:
- No ExampleSelector, file upload, clear buttons
- No `.header-left`, `.example-controls` wrapper divs
- The additional DOM complexity in editor-examples triggered the race condition

---

## SOLUTION: Single Instance with Dynamic Repositioning

### Pattern: Follow ViewerCanvas Approach

ViewerCanvas already uses single-instance repositioning. Apply the same pattern to CodeEditor.

### Implementation

**1. Single instance container** (EditorLayout.svelte)
```svelte
<!-- Single CodeEditor instance (repositioned based on mobile/desktop) -->
<div id="code-editor-container" style="display: none;">
  <CodeEditor {onExecute} />
</div>
```

**2. Target containers with IDs**
```svelte
<!-- Mobile -->
<div class="code-panel" id="code-panel-mobile" class:hidden={mobileActiveTab !== "code"}>
  <!-- CodeEditor will be positioned here via JavaScript -->
</div>

<!-- Desktop -->
<div class="left-panel" id="code-panel-desktop" style="width: {splitPosition}%">
  <!-- CodeEditor will be positioned here via JavaScript -->
</div>
```

**3. Reposition on mount**
```typescript
codeEditorContainer = document.getElementById("code-editor-container");
if (codeEditorContainer) {
  const targetContainer = isMobile
    ? document.getElementById("code-panel-mobile")
    : document.getElementById("code-panel-desktop");

  if (targetContainer) {
    codeEditorContainer.style.display = "block";
    targetContainer.appendChild(codeEditorContainer);
  }
}
```

**4. Reposition on mobile/desktop switch**
```typescript
$effect(() => {
  if (!codeEditorContainer) return;

  const targetContainer = isMobile
    ? document.getElementById("code-panel-mobile")
    : document.getElementById("code-panel-desktop");

  if (targetContainer && codeEditorContainer.parentElement !== targetContainer) {
    targetContainer.appendChild(codeEditorContainer);
  }
});
```

**5. CSS for proper sizing**
```css
:global(#code-editor-container) {
  width: 100%;
  height: 100%;
}
```

**6. Simplify CodeEditor.svelte**
Remove ALL dual-instance guard logic:
- No `monacoLoaded` checks
- No polling for `editorContainer`
- No `document.body.contains()` checks
- Clean, simple `onMount` initialization

### Benefits

1. **Single Monaco instance** - No race conditions
2. **Stable DOM** - Container exists before Monaco initializes
3. **Consistent pattern** - Same as ViewerCanvas repositioning
4. **Simpler code** - No complex guard logic
5. **Better performance** - One editor instead of two

### Files Modified

- `src/components/code/EditorLayout.svelte`: Single instance + repositioning
- `src/components/code/CodeEditor.svelte`: Removed dual-instance guards

### Status

**FIXED** - Single instance architecture resolves all issues.

### Verification

Tested and confirmed working:
- Monaco initializes without errors
- Editor updates when loading examples
- Editor updates when clearing code
- Editor updates when uploading files
- Editor repositions correctly between mobile/desktop layouts
- Code execution works
- No race conditions or dual-instance conflicts

### Debug Logging

Added module-specific debug flags for future troubleshooting:
- `VITE_DEBUG_CODE_EDITOR` - Monaco initialization and $effect updates
- `VITE_DEBUG_EDITOR_LAYOUT` - Example loading, clear code, file upload

Enable in `.env.local` and restart dev server to see logs.

