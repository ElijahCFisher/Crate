import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Header from './Header';
import EntryTable from '../Entries/EntryTable';
import AddEditEntryModal from '../Entries/AddEditEntryModal';
import DeleteConfirmDialog from '../Entries/DeleteConfirmDialog';
import ExportImportDialog from '../ExportImport/ExportImportDialog';
import CategoriesPanel from '../Categories/CategoriesPanel';

export default function AppLayout({ auth, data, onReauthenticate }) {
  const {
    foodEntries,
    categories,
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

  // Tab
  const [tab, setTab] = useState('entries');

  // Modal state
  const [addEditOpen, setAddEditOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [deleteDialogEntry, setDeleteDialogEntry] = useState(null);
  const [exportImportOpen, setExportImportOpen] = useState(false);

  function openAdd() {
    setEditingEntry(null);
    setAddEditOpen(true);
  }

  function openEdit(entry) {
    setEditingEntry(entry);
    setAddEditOpen(true);
  }

  function closeAddEdit() {
    setAddEditOpen(false);
    setEditingEntry(null);
  }

  /**
   * Called by AddEditEntryModal on submit.
   */
  function handleSave(payload) {
    if (editingEntry) {
      modifyEntry(editingEntry.uuid, payload);
    } else {
      addEntry(payload);
    }
  }

  /**
   * Called by CreateCategoryDialog (add mode) or CategoriesPanel add.
   * Returns entry synchronously so the form can immediately select the new UUID.
   */
  function handleAddCategory(categoryData) {
    return addCategory(categoryData);
  }

  /**
   * Called by CategoriesPanel edit. Computes diff and fires modifyEntry.
   */
  function handleEditCategory(editEntry, formData) {
    const updates = {};
    if ((formData.name || '') !== (editEntry.restaurantName || ''))
      updates.restaurantName = formData.name || '';
    if ((formData.ratingCategory || '') !== (editEntry.ratingCategory || ''))
      updates.ratingCategory = formData.ratingCategory || '';
    const newScore = formData.score != null ? formData.score : null;
    if (newScore !== editEntry.score) updates.score = newScore;
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
        syncing={syncing}
        syncError={syncError}
        onClearError={() => setSyncError(null)}
        onReauthenticate={onReauthenticate}
        onOpenExportImport={() => setExportImportOpen(true)}
        onSignOut={auth.signOut}
        isOffline={isOffline}
        pendingCount={pendingCount}
      />

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
      </Container>

      {/* Add / Edit entry modal */}
      <AddEditEntryModal
        open={addEditOpen}
        entry={editingEntry}
        categories={categories}
        onSave={handleSave}
        onAddCategory={handleAddCategory}
        onClose={closeAddEdit}
      />

      {/* Delete confirm (for food entries) */}
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

      {/* Full-screen loading overlay on initial load */}
      <Backdrop open={loading} sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}>
        <Box sx={{ textAlign: 'center', color: 'white' }}>
          <CircularProgress color="inherit" sx={{ mb: 2 }} />
          <Typography>Loading your data from Google Drive…</Typography>
        </Box>
      </Backdrop>
    </Box>
  );
}
