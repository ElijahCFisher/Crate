import React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import GoogleIcon from '@mui/icons-material/Google';

export default function LoginPage({ signIn, isSigningIn, authError }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
      }}
    >
      <Card sx={{ maxWidth: 420, width: '100%', mx: 2, borderRadius: 3, boxShadow: 8 }}>
        <CardContent sx={{ p: 5, textAlign: 'center' }}>
          <RestaurantIcon sx={{ fontSize: 64, color: 'primary.main', mb: 1 }} />
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Food Ratings
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Sign in with Google to access your ratings stored in Google Drive.
          </Typography>

          {authError && (
            <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
              {authError}
            </Alert>
          )}

          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={isSigningIn ? <CircularProgress size={20} color="inherit" /> : <GoogleIcon />}
            onClick={signIn}
            disabled={isSigningIn}
            sx={{ py: 1.5, fontSize: '1rem', borderRadius: 2 }}
          >
            {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
          </Button>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
            Requires access to Google Drive to read and write your data file.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
