# MySurfLife Claude Code Workflows Setup

## ✅ Setup Complete

Custom Claude Code workflows have been configured for MySurfLife with automated code and design reviews.

## 📁 Files Created

### Slash Commands
```
.claude/slash-commands/
├── review.md               # Code review slash command
└── design-review.md        # Design review slash command
```

### Subagent Configurations
```
.claude/agents/
├── mysurflife-code-reviewer.md      # Code review agent
└── mysurflife-design-reviewer.md    # Design review agent
```

### MCP Configuration
```
.mcp.json                   # Playwright MCP server config
```

### Documentation
```
CLAUDE.md                   # Updated with workflow documentation
```

## 🚀 How to Use

### Code Review

For any backend or frontend code changes:

```bash
# Make your changes
git add .
git commit -m "Your commit message"

# Run code review
/review
```

**What Gets Reviewed:**
- ✅ Async patterns (backend)
- ✅ JSON sanitization (NaN/Inf removal)
- ✅ Canvas lifecycle (frontend)
- ✅ Alpha handling and Z-index
- ✅ Caching strategy
- ✅ Error handling
- ✅ MySurfLife-specific patterns

**Output:**
- [Critical/Blocker] - Must fix before merge
- [Improvement] - Recommended changes
- [Nit] - Optional polish

### Design Review

For any UI/visual changes:

```bash
# Make your changes
npm start  # Ensure dev server running

# Run design review
/design-review
```

**What Gets Reviewed:**
- ✅ Interaction flow and usability
- ✅ Visual hierarchy
- ✅ Responsive behavior (uses Playwright)
- ✅ Canvas rendering quality
- ✅ Data visualization clarity
- ✅ Accessibility (WCAG AA)
- ✅ Professional polish

**Playwright Integration:**
- Automatically captures screenshots
- Tests at multiple breakpoints (mobile/tablet/desktop)
- Verifies interactions
- Checks console errors

## 🎯 MySurfLife-Specific Checks

### Backend Critical
1. ❌ Missing `json_sanitize()` before API response
2. ❌ Blocking I/O instead of `async/await`
3. ❌ Longitude not normalized (0-360 → -180-180)
4. ❌ Missing error handling for external APIs
5. ❌ Incorrect cache TTL or key format
6. ❌ Improper semaphore usage

### Frontend Critical
1. ❌ Canvas not removed from DOM in cleanup
2. ❌ Using `ctx.globalAlpha` (double alpha)
3. ❌ Using `'multiply'` blending (darkening artifacts)
4. ❌ Z-index conflicts violating hierarchy
5. ❌ Animation frame not cancelled in cleanup
6. ❌ Missing field interpolation boundary checks

## 📊 Workflow Integration

### Development Process
1. **Write Code** → Make changes to backend/frontend
2. **Commit** → `git commit` your changes
3. **Review** → Run `/review` for code quality
4. **Fix Issues** → Address Critical/Blocker items
5. **Design Check** → Run `/design-review` for UI changes
6. **Polish** → Implement Improvements
7. **Merge** → Create PR after reviews pass

### Pre-Merge Checklist
- [ ] `/review` completed with no Critical issues
- [ ] `/design-review` completed for UI changes (no Critical issues)
- [ ] All Improvements considered and addressed or documented
- [ ] Tests pass (backend: pytest, frontend: npm test)
- [ ] Documentation updated if needed

## 🔧 Configuration Details

### Slash Command Location
`.claude/slash-commands/` - Claude Code automatically discovers these

### Agent Configuration
`.claude/agents/` - Subagents preserve context and use Opus model for thorough analysis

### MCP Servers
`.mcp.json` - Playwright MCP enabled for browser automation in design reviews

### Settings
`.claude/settings.local.json` - Auto-approves project MCP servers

## 📚 Reference Documentation

**Source Workflows:**
- [Claude Code Workflows by Patrick Ellis](https://github.com/patrickellis/claude-code-workflows)
- [Code Review Tutorial](https://www.youtube.com/watch?v=nItsfXwujjg)
- [Design Review Tutorial](https://www.youtube.com/watch?v=xOO8Wt_i72s)

**MySurfLife Customizations:**
- Ocean data processing patterns from CLAUDE.md
- Canvas rendering best practices from .cursorrules
- Geospatial visualization standards
- Real-time forecasting UX patterns

## 🎓 Tips

1. **Run reviews frequently** - Don't wait until PR time
2. **Address Critical issues immediately** - They're blockers for a reason
3. **Learn from reviews** - Agents reference MySurfLife patterns
4. **Use both workflows** - Code + Design for full-stack changes
5. **Leverage Playwright** - Design review includes visual verification

## 🔄 Next Steps

To activate in new Claude Code session:
1. Exit current session
2. Start new Claude Code session
3. Run `/review` or `/design-review` on any changes

The workflows are now part of your MySurfLife development process!

---

**Setup Date:** 2025-12-19
**Status:** ✅ Active and Ready
