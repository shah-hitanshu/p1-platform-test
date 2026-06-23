# Session Memo: Plugin Rail Toggle Implementation

## Current Situation (2026-06-18)

We're implementing a toggle button in the Puck editor's subheader to show/hide the plugin rail (left navigation menu with Blocks/Outline/History/Data sources).

## What Works ✓

1. **Left Panel Toggle** (tableRows icon) - Controls `_BlocksPlugin_1ey1i_1`
   - State: `leftSideBarVisible` (boolean)
   - Working correctly ✓

2. **Right Panel Toggle** (penField icon) - Controls `_Sidebar_o396p_1 _Sidebar--right_o396p_25`
   - State: `rightSideBarVisible` (boolean)  
   - Working correctly ✓

## What Doesn't Work ✗

3. **Plugin Rail Toggle** (angleRight/angleLeft icons) - Should control `_PuckLayout-nav_1dd16_192`
   - Current state: `itemSelectorVisible` (boolean)
   - **Problem**: Clicking the button does nothing - no element on the page changes
   - The nav menu markup:
     ```html
     <div class="_PuckLayout-nav_1dd16_192">
       <nav class="_Nav_1tvxq_1">
         <ul class="_Nav-list_1tvxq_5">
           <li>Blocks</li>
           <li>Outline</li>
           <li>History</li>
           <li>Data sources</li>
         </ul>
       </nav>
     </div>
     ```

## Current Implementation

**File: `packages/puck-css/src/editor/plugin/P1Plugin.tsx`**

```typescript
interface PuckUiState {
  leftSideBarVisible: boolean;
  rightSideBarVisible: boolean;
  itemSelectorVisible?: boolean;
}

// In P1SubheaderBridgeInner:
const leftPanelVisible = puckUi?.leftSideBarVisible ?? true;
const pluginRailVisible = puckUi?.itemSelectorVisible ?? true;
const rightPanelVisible = puckUi?.rightSideBarVisible ?? true;

const handleToggleLeftPanel = () => {
  puckDispatch?.({ type: 'setUi', ui: { leftSideBarVisible: !leftPanelVisible } });
};

const handleTogglePluginRail = () => {
  puckDispatch?.({ type: 'setUi', ui: { itemSelectorVisible: !pluginRailVisible } });
};
```

**File: `packages/puck-css/src/pds/components/P1EditorSubheader.tsx`**

```typescript
<IconButton
  ariaLabel="Toggle plugin rail"
  iconName={pluginRailVisible ? "angleRight" : "angleLeft"}
  size="s"
  hasTooltip={false}
  hasBorder={false}
  aria-pressed={pluginRailVisible}
  onClick={onTogglePluginRail}
/>
```

## Investigation Done

1. User tested clicking the button - nothing happens
2. User checked browser DevTools - no class/attribute changes on `_PuckLayout-nav_1dd16_192` when clicking
3. We verified `itemSelectorVisible` is being toggled in state
4. **Conclusion**: `itemSelectorVisible` does NOT control the plugin rail navigation menu

## Next Steps Needed

1. Find what actually controls `_PuckLayout-nav_1dd16_192` visibility
2. Options to investigate:
   - Look at Puck's source code/documentation for the correct state property
   - Check if it requires custom CSS to hide/show instead of a built-in state
   - See if there's a different Puck UI state property we haven't found yet
   - Consider implementing a custom DOM manipulation solution if Puck doesn't expose this control

## Key Files

- `packages/puck-css/src/editor/plugin/P1Plugin.tsx` - State management
- `packages/puck-css/src/pds/components/P1EditorSubheader.tsx` - Toggle button UI
- `packages/puck-css/src/pds/components/P1EditorSubheader.module.css` - Styles

## Context Links

- User said "you messed up" - I learned to ask what's wrong instead of guessing ✓
- This is NOT about replacing existing functionality - we need to ADD a new toggle
- The three panels are independent and should all work simultaneously
