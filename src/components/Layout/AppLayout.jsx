import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useDevicePreference, TAB_POSITION_KEY, TAB_POSITIONS } from '../../hooks/useDevicePreference';
import Header from './Header';
import EntryTable from '../Entries/EntryTable';
import AddEditEntryModal from '../Entries/AddEditEntryModal';
import DeleteConfirmDialog from '../Entries/DeleteConfirmDialog';
import ExportImportDialog from '../ExportImport/ExportImportDialog';
import CategoriesPanel from '../Categories/CategoriesPanel';
import CreateCategoryDialog from '../Categories/CreateCategoryDialog';
import BulkAddsPanel from '../BulkAdds/BulkAddsPanel';
import FriendsPanel from '../Friends/FriendsPanel';
import FollowRequestDialog from '../Friends/FollowRequestDialog';
import SettingsPage from '../Settings/SettingsPage';
import FindReplaceDialog from '../Entries/FindReplaceDialog';
import NotesPanel from '../Notes/NotesPanel';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { useSettings } from '../../hooks/useSettings';
import { countUnsyncedChanges } from '../../hooks/useData';
import { shareFile } from '../../services/driveService';
import {
  LINKABLE_FIELDS, makeLinkKeyResolver, resolveLinkPlan, collectLinkedFollowers,
} from '../../utils/linkUtils';

function decodeFollowRequest(encoded) {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function sameUuidList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((uuid, i) => uuid === b[i]);
}

export default function AppLayout({ auth, data, onReauthenticate, onSignOut }) {
  const {
    combined,
    foodEntries,
    categories,
    fileId: dataFileId,
    folderId,
    picturesFolderId,
    loading,
    syncing,
    syncError,
    setSyncError,
    addEntry,
    addEntryGroups,
    addEntriesWithLinks,
    addCategory,
    modifyEntry,
    deleteEntry,
    applyRebalance,
    importCsv,
    exportCsv,
    isOffline,
    pendingCount,
  } = data;

  const {
    fileId: settingsFileId,
    bulkAdds, addBulkAdd, updateBulkAdd, setBulkAddsLocal,
    following, addToFollowing, removeFromFollowing, promoteToFollowing,
    requestedToFollow, addToRequestedToFollow, removeFromRequestedToFollow,
    sharedWith, addToSharedWith,
    showAdvancedByDefault, updateShowAdvancedByDefault,
    notes, updateNotes,
    searchVocabulary, updateSearchVocabulary,
  } = useSettings(folderId);

  // Tab
  const [tab, setTab] = useState('entries');
  const wideScreen = useMediaQuery((theme) => theme.breakpoints.up('md'), { noSsr: true });
  const [tabPosition] = useDevicePreference(TAB_POSITION_KEY, 'side', TAB_POSITIONS);
  const sideTabs = wideScreen && tabPosition === 'side';
  // Tabs needs its Tab children directly, so the same list serves both layouts.
  const tabItems = [
    <Tab key="entries" value="entries"
      label={`Food Entries${foodEntries.length ? ` (${foodEntries.length})` : ''}`} />,
    <Tab key="categories" value="categories"
      label={`Categories${categories.length ? ` (${categories.length})` : ''}`} />,
    <Tab key="bulkAdds" value="bulkAdds"
      label={`Bulk Adds${bulkAdds.length ? ` (${bulkAdds.length})` : ''}`} />,
    <Tab key="friends" value="friends"
      label={`Friends${following.length ? ` (${following.length})` : ''}`} />,
    <Tab key="notes" label="Notes" value="notes" />,
    <Tab key="settings" label="Settings" value="settings" />,
  ];

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [bulkAddEntries, setBulkAddEntries] = useState(null);
  const [cloneSource, setCloneSource] = useState(null);
  // A category opened from its chip in the entries table.
  const [viewingCategory, setViewingCategory] = useState(null);
  const [deleteDialogEntry, setDeleteDialogEntry] = useState(null);
  const [exportImportOpen, setExportImportOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [linkedEdit, setLinkedEdit] = useState(null);

  // Follow request from URL
  const [followRequester, setFollowRequester] = useState(null);

  // Signing out wipes this device's copy, including anything not yet synced.
  const [signOutUnsynced, setSignOutUnsynced] = useState(0);

  function requestSignOut() {
    const unsynced = countUnsyncedChanges();
    if (unsynced > 0) setSignOutUnsynced(unsynced);
    else onSignOut();
  }

  // Grandfather existing sharedWith people into the Pictures folder
  useEffect(() => {
    if (!picturesFolderId || !sharedWith?.length) return;
    for (const person of sharedWith) {
      if (person?.email) shareFile(picturesFolderId, person.email).catch(() => {});
    }
  }, [picturesFolderId, sharedWith]);

  // Detect ?followRequest= in the URL on load (and after auth)
  useEffect(() => {
    if (!auth.isAuthenticated || !dataFileId) return;
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('followRequest');
    if (!encoded) return;
    const decoded = decodeFollowRequest(encoded);
    if (decoded?.email) {
      setFollowRequester(decoded);
      // Clean the URL so refreshing doesn't re-trigger the dialog
      const url = new URL(window.location.href);
      url.searchParams.delete('followRequest');
      window.history.replaceState({}, '', url.toString());
    }
  }, [auth.isAuthenticated, dataFileId]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (
        e.key !== 'n' ||
        addEditOpen || deleteDialogEntry || exportImportOpen || followRequester || findReplaceOpen ||
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.isContentEditable
      ) return;
      e.preventDefault();
      setEditingEntry(null);
      setBulkAddEntries(null);
      setAddEditOpen(true);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [addEditOpen, deleteDialogEntry, exportImportOpen, followRequester, findReplaceOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'h' || !e.ctrlKey || addEditOpen || deleteDialogEntry || exportImportOpen || followRequester) return;
      e.preventDefault();
      setFindReplaceOpen(true);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [addEditOpen, deleteDialogEntry, exportImportOpen, followRequester]);

  function openAdd() {
    setEditingEntry(null);
    setBulkAddEntries(null);
    setCloneSource(null);
    setAddEditOpen(true);
  }

  function openFromBulk(entries) {
    setEditingEntry(null);
    setBulkAddEntries(entries);
    setCloneSource(null);
    setAddEditOpen(true);
  }

  function openEdit(entry) {
    setEditingEntry(entry);
    setBulkAddEntries(null);
    setCloneSource(null);
    setAddEditOpen(true);
  }

  function openClone(entry) {
    setEditingEntry(null);
    setBulkAddEntries(null);
    setCloneSource(entry);
    setAddEditOpen(true);
  }

  function closeAddEdit() {
    setAddEditOpen(false);
    setEditingEntry(null);
    setBulkAddEntries(null);
    setCloneSource(null);
  }

  function openCategory(uuid) {
    const category = categories.find((c) => c.uuid === uuid);
    if (category) setViewingCategory(category);
  }

  /** Same shape CategoriesPanel hands back, so the dialog can close on it. */
  function handleViewingCategorySave(categoryData) {
    if (!viewingCategory) return null;
    handleEditCategory(viewingCategory, categoryData);
    return {
      ...viewingCategory,
      restaurantName: categoryData.name,
      ratingCategory: categoryData.ratingCategory,
      score: categoryData.score,
      dateRated: categoryData.dateRated,
      additionalInfo: categoryData.additionalInfo || '',
    };
  }

  /** Write the `linkedFields` maps a just-saved modal asked for. */
  function applyLinkPlan(linkPlan, createdByGroup) {
    if (!linkPlan) return;
    const resolveKey = makeLinkKeyResolver(createdByGroup);
    for (const { uuid, linkedFields } of resolveLinkPlan(linkPlan, resolveKey, combined)) {
      modifyEntry(uuid, { linkedFields });
    }
  }

  /**
   * Editing an entry on its own still moves its linked followers — that's the
   * whole point of the link — but it's easy to do by accident from the table,
   * so it's announced with an undo rather than done silently.
   */
  function propagateToLinked(leaderEntry, payload) {
    const fields = Object.keys(payload).filter((f) => LINKABLE_FIELDS.includes(f));
    if (fields.length === 0) return;

    const touched = new Map();
    for (const field of fields) {
      for (const uuid of collectLinkedFollowers(combined, leaderEntry.uuid, field)) {
        const follower = combined.get(uuid);
        if (!follower || follower[field] === payload[field]) continue;
        if (!touched.has(uuid)) touched.set(uuid, { updates: {}, previous: {} });
        const t = touched.get(uuid);
        t.updates[field] = payload[field];
        t.previous[field] = follower[field];
      }
    }
    if (touched.size === 0) return;

    for (const [uuid, { updates }] of touched) modifyEntry(uuid, updates);
    setLinkedEdit({
      count: touched.size,
      previous: Array.from(touched, ([uuid, { previous }]) => [uuid, previous]),
    });
  }

  function undoLinkedEdit() {
    if (!linkedEdit) return;
    for (const [uuid, previous] of linkedEdit.previous) modifyEntry(uuid, previous);
    setLinkedEdit(null);
  }

  function handleSave(payload, newGroupData = [], linkPlan = null) {
    if (editingEntry) {
      if (Object.keys(payload).length > 0) modifyEntry(editingEntry.uuid, payload);
      const createdByGroup = [];
      for (const { entries, existingUuids } of newGroupData) {
        createdByGroup.push(entries.length > 0 ? addEntriesWithLinks(entries, existingUuids) : []);
      }
      propagateToLinked(editingEntry, payload);
      applyLinkPlan(linkPlan, createdByGroup);
      if ('identicals' in payload) {
        const nextIdenticals = payload.identicals || [];
        const nextSet = new Set(nextIdenticals);
        const previousSet = new Set(editingEntry.identicals || []);
        const relatedUuids = new Set([...nextSet, ...previousSet]);
        const entriesByUuid = new Map(foodEntries.map((entry) => [entry.uuid, entry]));

        for (const uuid of relatedUuids) {
          const relatedEntry = entriesByUuid.get(uuid);
          if (!relatedEntry) continue;

          const relatedIdenticals = relatedEntry.identicals || [];
          const reconciled = nextSet.has(uuid)
            ? relatedIdenticals.includes(editingEntry.uuid)
              ? relatedIdenticals
              : [...relatedIdenticals, editingEntry.uuid]
            : relatedIdenticals.filter((id) => id !== editingEntry.uuid);

          if (!sameUuidList(relatedEntry.identicals || [], reconciled)) {
            modifyEntry(uuid, { identicals: reconciled });
          }
        }
      }
    } else {
      addEntry(payload);
    }
  }

  function handleSaveGroups(groups, linkPlan = null) {
    const builtGroups = addEntryGroups(groups, settingsFileId);
    applyLinkPlan(linkPlan, builtGroups || []);
    if (builtGroups) {
      const allUuids = builtGroups.flat().map((e) => e.uuid);
      // addEntryGroups already persists the bulkAdds entry (via
      // dataService.addBulkRating) when settingsFileId is available — this
      // just mirrors that into local state so the Bulk Adds tab updates
      // immediately, same as the rest of the app's optimistic-UI pattern.
      if (allUuids.length > 1) {
        if (settingsFileId) setBulkAddsLocal([allUuids, ...bulkAdds]);
        else addBulkAdd(allUuids); // settings not loaded yet — fall back to the old persist-directly path
      }
    }
  }

  function handleBulkSave(changes, newGroupData = [], linkPlan = null) {
    for (const { uuid, updates } of changes) {
      modifyEntry(uuid, updates);
    }
    const allNewUuids = [];
    const createdByGroup = [];
    for (const { entries, existingUuids } of newGroupData) {
      if (entries.length === 0) { createdByGroup.push([]); continue; }
      const newEntries = addEntriesWithLinks(entries, existingUuids);
      createdByGroup.push(newEntries);
      allNewUuids.push(...newEntries.map((e) => e.uuid));
    }
    applyLinkPlan(linkPlan, createdByGroup);
    if (allNewUuids.length > 0 && bulkAddEntries?.length > 0) {
      updateBulkAdd(bulkAddEntries[0].uuid, allNewUuids);
    }
  }

  function handleAddCategory(categoryData) {
    return addCategory(categoryData);
  }

  function handleEditCategory(editEntry, formData) {
    const updates = {};
    if ((formData.name || '') !== (editEntry.restaurantName || ''))
      updates.restaurantName = formData.name || '';
    if ((formData.ratingCategory || '') !== (editEntry.ratingCategory || ''))
      updates.ratingCategory = formData.ratingCategory || '';
    const newScore = formData.score != null && formData.score !== '' ? formData.score : null;
    const origScore = editEntry.score != null ? String(editEntry.score) : null;
    if (newScore !== origScore) updates.score = newScore;
    const newDate = formData.dateRated ?? null;
    if (newDate !== editEntry.dateRated) updates.dateRated = newDate;
    if ((formData.additionalInfo || '') !== (editEntry.additionalInfo || ''))
      updates.additionalInfo = formData.additionalInfo || '';
    if (Object.keys(updates).length > 0) modifyEntry(editEntry.uuid, updates);
  }

  function handleReplaceAll(changes) {
    for (const { uuid, updates } of changes) {
      modifyEntry(uuid, updates);
    }
  }

  function handleDeleteConfirm() {
    if (!deleteDialogEntry) return;
    deleteEntry(deleteDialogEntry.uuid);
    setDeleteDialogEntry(null);
  }

  function handleFollowAccept(requester) {
    addToSharedWith({ email: requester.email, displayName: requester.displayName || requester.email });
    setFollowRequester(null);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        isAuthenticated={auth.isAuthenticated}
        isSilentTrying={auth.isSilentTrying}
        isSigningIn={auth.isSigningIn}
        authError={auth.authError}
        onSignIn={auth.signIn}
        onSignOut={requestSignOut}
        syncing={syncing}
        syncError={syncError}
        onClearError={() => setSyncError(null)}
        onReauthenticate={onReauthenticate}
        onOpenExportImport={() => setExportImportOpen(true)}
        isOffline={isOffline}
        pendingCount={pendingCount}
      />

      {/* Non-blocking thin progress bar while fetching Drive data */}
      {loading && <LinearProgress sx={{ height: 2 }} />}

      <Box sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
      {/* Tab switcher — down the side on wide screens, across the top otherwise */}
      {sideTabs && (
        <Box component="nav" sx={{ flexShrink: 0, borderRight: 1, borderColor: 'divider', pt: 3 }}>
          <Tabs
            orientation="vertical"
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              position: 'sticky',
              top: 16,
              '& .MuiTab-root': { alignItems: 'flex-start', textAlign: 'left', minHeight: 44, px: 2.5 },
            }}
          >
            {tabItems}
          </Tabs>
        </Box>
      )}
      <Container maxWidth="xl" sx={{ py: 3, flex: 1, minWidth: 0 }}>
        {!sideTabs && (
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            {tabItems}
          </Tabs>
        )}

        {tab === 'entries' && (
          <EntryTable
            foodEntries={foodEntries}
            categories={categories}
            loading={loading}
            onAdd={openAdd}
            onEdit={openEdit}
            onClone={openClone}
            onOpenCategory={openCategory}
            searchVocabulary={searchVocabulary}
            onDelete={(entry) => setDeleteDialogEntry(entry)}
            onOpenFindReplace={() => setFindReplaceOpen(true)}
          />
        )}

        {tab === 'categories' && (
          <CategoriesPanel
            categories={categories}
            combined={combined}
            onAdd={handleAddCategory}
            onEdit={handleEditCategory}
            onDelete={(entry) => deleteEntry(entry.uuid)}
            onAddCategory={handleAddCategory}
            onRebalance={applyRebalance}
          />
        )}

        {tab === 'bulkAdds' && (
          <BulkAddsPanel
            bulkAdds={bulkAdds}
            combined={combined}
            onOpen={openFromBulk}
          />
        )}

        {tab === 'notes' && (
          <NotesPanel notes={notes} onChange={updateNotes} />
        )}

        {tab === 'settings' && (
          <SettingsPage
            showAdvancedByDefault={showAdvancedByDefault}
            onUpdateShowAdvancedByDefault={updateShowAdvancedByDefault}
            searchVocabulary={searchVocabulary}
            onUpdateSearchVocabulary={updateSearchVocabulary}
          />
        )}

        {tab === 'friends' && (
          <FriendsPanel
            following={following}
            requestedToFollow={requestedToFollow}
            sharedWith={sharedWith}
            userProfile={auth.userProfile}
            dataFileId={dataFileId}
            picturesFolderId={picturesFolderId}
            onAddToFollowing={addToFollowing}
            onRemoveFromFollowing={removeFromFollowing}
            onRemoveFromRequestedToFollow={removeFromRequestedToFollow}
            onPromoteToFollowing={promoteToFollowing}
            onAddToSharedWith={addToSharedWith}
            onAddToRequestedToFollow={addToRequestedToFollow}
          />
        )}
      </Container>
      </Box>

      {/* Add / Edit entry modal */}
      <AddEditEntryModal
        open={addEditOpen}
        entry={editingEntry}
        initialEntries={bulkAddEntries}
        prefill={cloneSource}
        categories={categories}
        foodEntries={foodEntries}
        onSave={handleSave}
        onClone={openClone}
        onSaveGroups={!editingEntry && !bulkAddEntries ? handleSaveGroups : undefined}
        onBulkSave={bulkAddEntries ? handleBulkSave : undefined}
        onAddCategory={handleAddCategory}
        onClose={closeAddEdit}
        showAdvancedByDefault={showAdvancedByDefault}
        picturesFolderId={picturesFolderId}
      />

      {/* Category opened from a chip in the entries table */}
      <CreateCategoryDialog
        open={!!viewingCategory}
        editEntry={viewingCategory}
        initialName=""
        categories={categories}
        combined={combined}
        onSave={handleViewingCategorySave}
        onAddCategory={handleAddCategory}
        onRebalance={applyRebalance}
        onClose={() => setViewingCategory(null)}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteDialogEntry}
        entry={deleteDialogEntry}
        categories={categories}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogEntry(null)}
      />

      {/* Export / Import */}
      <ExportImportDialog
        open={exportImportOpen}
        onClose={() => setExportImportOpen(false)}
        exportCsv={exportCsv}
        onImportCsv={importCsv}
        syncing={syncing}
      />

      {/* Find & Replace */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        foodEntries={foodEntries}
        categories={categories}
        onReplaceAll={handleReplaceAll}
      />

      {/* Linked-field propagation notice */}
      <Snackbar
        open={!!linkedEdit}
        autoHideDuration={8000}
        onClose={() => setLinkedEdit(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={linkedEdit
          ? `Also updated ${linkedEdit.count} linked ${linkedEdit.count === 1 ? 'entry' : 'entries'}`
          : ''}
        action={
          <Button color="secondary" size="small" onClick={undoLinkedEdit}>
            Undo
          </Button>
        }
      />

      {/* Sign out with changes still waiting to sync */}
      <Dialog open={signOutUnsynced > 0} onClose={() => setSignOutUnsynced(0)}>
        <DialogTitle>Sign out and discard unsynced changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {signOutUnsynced} change{signOutUnsynced === 1 ? " hasn't" : "s haven't"} reached
            Google Drive yet. Signing out clears everything stored on this device, so
            {signOutUnsynced === 1 ? ' it' : ' they'} would be lost. Staying signed in lets
            {signOutUnsynced === 1 ? ' it' : ' them'} sync once you're back online.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignOutUnsynced(0)} autoFocus>Stay signed in</Button>
          <Button
            color="error"
            onClick={() => {
              setSignOutUnsynced(0);
              onSignOut();
            }}
          >
            Sign out anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* Follow request from link */}
      <FollowRequestDialog
        open={!!followRequester}
        requester={followRequester}
        dataFileId={dataFileId}
        picturesFolderId={picturesFolderId}
        onAccept={handleFollowAccept}
        onDecline={() => setFollowRequester(null)}
      />
    </Box>
  );
}
