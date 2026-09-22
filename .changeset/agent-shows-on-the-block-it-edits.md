---
"@pantheon-systems/puck-css": major
---

**[Breaking Change]** People editing a page can now see which blocks Zappy is working on, and stop it, right on the canvas. This replaces the agent chip in the subheader, so `AgentChip` and `P1EditorSubheader`'s `agents` and `onStopAgent` props are removed.

### What Changed

- Blocks Zappy is working on are outlined with a Zappy badge. The outline clears when Zappy finishes.
- Selecting one of those blocks shows who asked Zappy for the change, with a Stop button.
- A block's toolbar is hidden while Zappy is working on it, so nobody can move, duplicate or delete the block mid-edit.
- The canvas follows Zappy to the block it is working on, unless that block is already in view.
- Agents are called "Zappy" everywhere in the editor, including avatars, the presence list and notifications.
- The page has a little more room around it in the canvas.

### Migration / Action Required

If you render `AgentChip` yourself, remove it. If you render `P1EditorSubheader`, drop its agent props; the editor now shows and stops agents on the canvas for you.

```diff
 <P1EditorSubheader
   context="branch"
-  agents={agents}
-  onStopAgent={stopAgent}
   onPublish={publish}
 />
```

Code or tests that expect an agent's registered name from the editor now get "Zappy". Read the name from the agent's presence record instead.
