import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import LinearProgress from '@mui/material/LinearProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Header from './Header';
import EntryTable from '../Entries/EntryTable';
import AddEditEntryModal from '../Entries/AddEditEntryModal';
import DeleteConfirmDialog from '../Entries/DeleteConfirmDialog';
import ExportImportDialog from '../ExportImport/ExportImportDialog';
import CategoriesPanel from '../Categories/CategoriesPanel';
import BulkAddsPanel from '../BulkAdds/BulkAddsPanel';
import { useSettings } from '../../hooks/useSettings';

export default function AppLayout({ auth, data, onReauthenticate }) {
  const {
    combined,
    foodEntries,
    categories,
    folderId,
    loading,
    syncing,
    syncError,
    setSyncError,
    addEntry,
    addCategory,
    modifyEntry,
    deleteEntry,
    importCsv,
    exportCsv,
    isOffline,
    pendingCount,
  } = data;

  const { bulkAdds, addBulkAdd } = useSettings(folderId);

  // Tab
  const [tab, setTab] = useState('entries');

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [bulkAddEntries, setBulkAddEntries] = useState(null);
  const [deleteDialogEntry, setDeleteDialogEntry] = useState(null);
  const [exportImportOpen, setExportImportOpen] = useState(false);

  function openAdd() {
    setEditingEntry(null);
    setBulkAddEntries(null);
    setAddEditOpen(true);
  }

  function openFromBulk(entries) {
    setEditingEntry(null);
    setBulkAddEntries(entries);
    setAddEditOpen(true);
  }

  function openEdit(entry) {
    setEditingEntry(entry);
    setBulkAddEntries(null);
    setAddEditOpen(true);
  }

  function closeAddEdit() {
    setAddEditOpen(false);
    setEditingEntry(null);
    setBulkAddEntries(null);
  }

  function handleSave(payload) {
    if (editingEntry) {
      modifyEntry(editingEntry.uuid, payload);
    } else {
      addEntry(payload);
    }
  }

  function handleSaveGroups(groups) {
    const allUuids = [];
    for (const group of groups) {
      const entries = addEntry(group);
      if (entries) allUuids.push(...entries.map((e) => e.uuid));
    }
    if (allUuids.length > 1) addBulkAdd(allUuids);
  }

  function handleBulkSave(changes) {
    for (const { uuid, updates } of changes) {
      modifyEntry(uuid, updates);
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

  function handleDeleteConfirm() {
    if (!deleteDialogEntry) return;
    deleteEntry(deleteDialogEntry.uuid);
    setDeleteDialogEntry(null);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        isAuthenticated={auth.isAuthenticated}
        isSilentTrying={auth.isSilentTrying}
        isSigningIn={auth.isSigningIn}
        authError={auth.authError}
        onSignIn={auth.signIn}
        onSignOut={auth.signOut}
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

      <Container maxWidth="xl" sx={{ py: 3, flex: 1 }}>
        {/* Tab switcher */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            label={`Food Entries${foodEntries.length ? ` (${foodEntries.length})` : ''}`}
            value="entries"
          />
          <Tab
            label={`Categories${categories.length ? ` (${categories.length})` : ''}`}
            value="categories"
          />
          <Tab
            label={`Bulk Adds${bulkAdds.length ? ` (${bulkAdds.length})` : ''}`}
            value="bulkAdds"
          />
        </Tabs>

        {tab === 'entries' && (
          <EntryTable
            foodEntries={foodEntries}
            categories={categories}
            loading={loading}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={(entry) => setDeleteDialogEntry(entry)}
          />
        )}

        {tab === 'categories' && (
          <CategoriesPanel
            categories={categories}
            onAdd={handleAddCategory}
            onEdit={handleEditCategory}
            onDelete={(entry) => deleteEntry(entry.uuid)}
            onAddCategory={handleAddCategory}
          />
        )}

        {tab === 'bulkAdds' && (
          <BulkAddsPanel
            bulkAdds={bulkAdds}
            combined={combined}
            onOpen={openFromBulk}
          />
        )}
      </Container>

      {/* Add / Edit entry modal */}
      <AddEditEntryModal
        open={addEditOpen}
        entry={editingEntry}
        initialEntries={bulkAddEntries}
        categories={categories}
        onSave={handleSave}
        onSaveGroups={!editingEntry && !bulkAddEntries ? handleSaveGroups : undefined}
        onBulkSave={bulkAddEntries ? handleBulkSave : undefined}
        onAddCategory={handleAddCategory}
        onClose={closeAddEdit}
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
    </Box>
  );
}
