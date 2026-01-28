# Admin Spot Editing - Testing Guide

## Quick Test Instructions

### Prerequisites
1. Backend running on port 8000
2. Frontend running on port 3000 (or production build)
3. Admin user account created and logged in

### Test 1: Admin Access Check

**Non-Admin User Test**:
1. Navigate to http://localhost:3000/spots/oceanside-harbor
2. ✅ PASS: Edit button should NOT be visible in header
3. ✅ PASS: Map should be static (not draggable)

**Admin User Test**:
1. Sign in with admin credentials
2. Navigate to http://localhost:3000/spots/oceanside-harbor
3. ✅ PASS: "✏️ Edit" button should be visible in header

### Test 2: Enter Edit Mode

1. Click "✏️ Edit" button
2. ✅ PASS: Button changes to "💾 Save" and "✖️ Cancel"
3. ✅ PASS: Map border turns blue (edit mode indicator)
4. ✅ PASS: Map becomes draggable (can pan and zoom)
5. ✅ PASS: Zoom controls appear on map
6. ✅ PASS: Marker becomes draggable
7. ✅ PASS: Info section changes to form fields
8. ✅ PASS: All form sections visible:
   - Basic Info (Name, Region, Subregion)
   - Characteristics (Break Type, Bottom Type, Wave Quality, Skill Level)
   - Conditions (Best Swell, Best Wind, Tide, Works From/To)
   - Location & Access (Location, Access, Parking)

### Test 3: Drag Marker

1. In edit mode, click and drag the map marker
2. ✅ PASS: Marker moves to new position
3. ✅ PASS: Coordinate display appears in top-right corner
4. ✅ PASS: Coordinates update in real-time as you drag
5. ✅ PASS: Coordinates show 6 decimal places (e.g., 33.195900, -117.388600)

### Test 4: Edit Form Fields

**Text Fields**:
1. Change spot name
2. ✅ PASS: Header title updates to show new name
3. ✅ PASS: Text appears in input field

**Dropdowns**:
1. Click "Break Type" dropdown
2. ✅ PASS: Options displayed: Beach, Reef, Point, River Mouth, Jetty, Mixed
3. Select different option
4. ✅ PASS: Selection changes

**Number Fields**:
1. Enter value in "Works From (ft)" field
2. ✅ PASS: Only numbers allowed
3. ✅ PASS: Value appears in input

**Textareas**:
1. Type in "Location Description"
2. ✅ PASS: Multi-line text entry works
3. ✅ PASS: Textarea can be resized vertically

### Test 5: Validation

**Required Field Test**:
1. Clear the "Spot Name" field
2. Click "💾 Save"
3. ✅ PASS: Error message appears: "Please fill in all required fields (Name, Region, Skill Level)"
4. ✅ PASS: Changes are NOT saved

**Coordinate Range Test**:
1. Manually set latitude to 100 (out of range)
2. Click "💾 Save"
3. ✅ PASS: Error message: "Latitude must be between -90 and 90"
4. ✅ PASS: Changes are NOT saved

### Test 6: Cancel Changes

1. Make several edits to fields
2. Drag marker to new position
3. Click "✖️ Cancel"
4. ✅ PASS: Returns to view mode
5. ✅ PASS: All changes discarded
6. ✅ PASS: Original values still displayed
7. ✅ PASS: Map returns to static mode
8. ✅ PASS: Error messages cleared

### Test 7: Save Changes

**Success Path**:
1. Enter edit mode
2. Make valid changes:
   - Change name to "Oceanside Harbor (Updated)"
   - Drag marker slightly north
   - Change break type to "jetty"
   - Update location description
3. Click "💾 Save"
4. ✅ PASS: Button shows "💾 Saving..." during save
5. ✅ PASS: Page reloads after successful save
6. ✅ PASS: New values appear in view mode
7. ✅ PASS: Map marker at new position
8. ✅ PASS: Updated fields display correctly

**Verify in Database**:
```bash
# Check backend logs for success message
tail -20 backend/backend.log | grep "Spot.*updated"

# Should see: ✅ Spot 'oceanside-harbor' updated by admin@example.com
```

### Test 8: API Endpoint Direct Test

**Using curl** (requires admin token):

```bash
# Get current admin token from browser localStorage
# Key: sb-duebzukxycgfkfjezwjq-auth-token
# Extract access_token from JSON

TOKEN="your-admin-token-here"

# Test update
curl -X PUT "http://localhost:8000/api/admin/surf-spots/oceanside-harbor" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Oceanside Harbor Test",
    "latitude": 33.1959,
    "longitude": -117.3886,
    "break_type": "jetty",
    "skill_level": "intermediate"
  }'

# Expected response:
# {"success": true, "message": "Spot updated successfully"}
```

### Test 9: Edge Cases

**Very Long Text**:
1. Enter 500 characters in Location Description
2. ✅ PASS: Text saves successfully
3. ✅ PASS: Displays correctly in view mode

**Empty Optional Fields**:
1. Clear all optional fields (subregion, descriptions)
2. ✅ PASS: Save succeeds
3. ✅ PASS: No errors displayed

**Rapid Clicking**:
1. Click "💾 Save" button multiple times quickly
2. ✅ PASS: Button disables after first click
3. ✅ PASS: Only one save request sent

### Test 10: Mobile Responsive

**Mobile View** (resize browser to 375px width):
1. ✅ PASS: Edit button visible and usable
2. ✅ PASS: Save/Cancel buttons stack or shrink appropriately
3. ✅ PASS: Form fields full width
4. ✅ PASS: Form row (Works From/To) stacks vertically
5. ✅ PASS: Coordinate display readable (smaller font)
6. ✅ PASS: Map dragging works on mobile

### Test 11: Authentication

**Expired Token**:
1. Wait for token to expire (or manually expire in localStorage)
2. Try to save changes
3. ✅ PASS: Error message displayed
4. ✅ PASS: 401 error in console

**Non-Admin User**:
1. Sign in as regular user (not admin)
2. Navigate to spot detail
3. ✅ PASS: Edit button NOT visible
4. If manually calling API:
   - ✅ PASS: 403 Forbidden error returned

## Known Issues / Expected Behavior

### Page Reload After Save
- **Expected**: Page reloads after successful save
- **Why**: Ensures all spot data is fresh from database
- **Not a bug**: Intentional design decision

### Concurrent Edits
- **Issue**: Two admins editing same spot = last write wins
- **Mitigation**: Document this limitation
- **Future**: Consider optimistic locking or edit notifications

### Hazards Field Not Editable
- **Issue**: Hazards is an array type, requires special handling
- **Status**: Out of scope for MVP
- **Future**: Add array input component

## Performance Checks

1. ✅ Page load time unaffected
2. ✅ Edit mode toggle instant (<100ms)
3. ✅ Marker drag smooth (60fps)
4. ✅ Save operation completes in <2 seconds
5. ✅ No memory leaks after multiple edit/cancel cycles

## Browser Compatibility

Test in:
- ✅ Chrome (latest)
- ✅ Safari (latest)
- ✅ Firefox (latest)
- ✅ Mobile Safari (iOS)
- ✅ Chrome Mobile (Android)

## Checklist Summary

- [ ] Admin sees edit button
- [ ] Non-admin does NOT see edit button
- [ ] Edit mode makes map interactive
- [ ] Marker is draggable in edit mode
- [ ] Coordinate display updates on drag
- [ ] All form fields editable
- [ ] Required field validation works
- [ ] Coordinate range validation works
- [ ] Cancel discards changes
- [ ] Save succeeds with valid data
- [ ] Page reloads after save
- [ ] Changes persist in database
- [ ] Error messages display correctly
- [ ] Mobile responsive
- [ ] API endpoint works directly

## Troubleshooting

**Edit button not showing for admin**:
- Check browser console for auth errors
- Verify admin flag in localStorage token
- Check backend /api/auth/check-admin endpoint

**Map not interactive in edit mode**:
- Check browser console for Leaflet errors
- Verify MapContainer props updated
- Check CSS for cursor: move on .hero-map.edit-mode

**Save button does nothing**:
- Check browser console for errors
- Verify API endpoint responding
- Check auth token in localStorage

**Form fields not showing**:
- Check browser console for React errors
- Verify FormField components imported
- Check conditional rendering logic

**Coordinates not updating on drag**:
- Check eventHandlers on Marker component
- Verify dragend event firing (console.log)
- Check setEditedSpot state update

## Success Criteria

All tests above pass = Implementation complete and working! ✅
