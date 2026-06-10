const API_BASE = 'http://localhost:5000/api';

let token = localStorage.getItem('token') || null;
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let isRegisterMode = false;

// --------------------------------------------------------------------------
// PAGE INITIALIZATION
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initAuthState();
  updateCalculations(); // Setup initial slider labels and charts
  fetchLeaderboard();
});

// --------------------------------------------------------------------------
// AUTHENTICATION LOGIC
// --------------------------------------------------------------------------
function initAuthState() {
  const authModal = document.getElementById('auth-modal');
  const userDisplay = document.getElementById('user-display');
  const authBtn = document.getElementById('auth-btn');
  const calcSubmitBtn = document.getElementById('btn-calc-submit');

  if (token && currentUser) {
    authModal.classList.add('hidden');
    userDisplay.classList.remove('hidden');
    userDisplay.textContent = `Welcome, ${currentUser.username}`;
    authBtn.textContent = 'Sign Out';
    calcSubmitBtn.removeAttribute('disabled');
    
    // Fetch user-specific metrics on login
    fetchUserHistory();
  } else {
    authModal.classList.remove('hidden');
    userDisplay.classList.add('hidden');
    authBtn.textContent = 'Sign In';
    calcSubmitBtn.setAttribute('disabled', 'true');
    resetMetrics();
  }
}

function toggleAuthMode() {
  isRegisterMode = !isRegisterMode;
  
  const modalTitle = document.getElementById('modal-title');
  const toggleText = document.getElementById('toggle-text');
  const toggleLink = document.getElementById('toggle-link');
  const registerFields = document.querySelectorAll('.id-register-only');

  if (isRegisterMode) {
    modalTitle.textContent = 'Sign Up';
    toggleText.textContent = 'Already have an account? ';
    toggleLink.textContent = 'Sign In';
    registerFields.forEach(el => el.classList.remove('hidden'));
  } else {
    modalTitle.textContent = 'Sign In';
    toggleText.textContent = "Don't have an account? ";
    toggleLink.textContent = 'Sign Up';
    registerFields.forEach(el => el.classList.add('hidden'));
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('username').value.trim();
  const passwordInput = document.getElementById('password').value;
  const regionInput = document.getElementById('region').value;

  if (!usernameInput || !passwordInput) return;

  const endpoint = isRegisterMode ? '/auth/register' : '/auth/login';
  const payload = {
    username: usernameInput,
    password: passwordInput,
    ...(isRegisterMode && { region: regionInput })
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Authentication failed.');
      return;
    }

    if (isRegisterMode) {
      // Registration success, switch to Login automatically
      alert('Registration successful! Please sign in.');
      toggleAuthMode();
      // Populate username field automatically
      document.getElementById('username').value = usernameInput;
      document.getElementById('password').value = '';
    } else {
      // Login success
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      
      initAuthState();
      fetchLeaderboard();
    }
  } catch (err) {
    console.error('[Auth HTTP Error]', err);
    alert('Failed to connect to the authentication service. Make sure backend is running.');
  }
}

function handleAuthAction() {
  if (token) {
    // Log out
    token = null;
    currentUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    initAuthState();
  } else {
    // Reveal Modal
    document.getElementById('auth-modal').classList.remove('hidden');
  }
}

// --------------------------------------------------------------------------
// CARBON CALCULATOR & RECOMMENDATIONS LOGIC
// --------------------------------------------------------------------------
function updateCalculations() {
  const travel = parseFloat(document.getElementById('sl-travel').value);
  const energy = parseFloat(document.getElementById('sl-energy').value);
  const food = parseFloat(document.getElementById('sl-food').value);
  const waste = parseFloat(document.getElementById('sl-waste').value);

  // Update text tags
  document.getElementById('lbl-travel').textContent = `${travel.toFixed(1)} kg`;
  document.getElementById('lbl-energy').textContent = `${energy.toFixed(1)} kg`;
  document.getElementById('lbl-food').textContent = `${food.toFixed(1)} kg`;
  document.getElementById('lbl-waste').textContent = `${waste.toFixed(1)} kg`;

  // Draw category charts (calculate height scaling)
  // Max ranges: Travel 30, Energy 30, Food 15, Waste 10
  document.getElementById('bar-travel').style.height = `${(travel / 30) * 180}px`;
  document.getElementById('bar-energy').style.height = `${(energy / 30) * 180}px`;
  document.getElementById('bar-food').style.height = `${(food / 15) * 180}px`;
  document.getElementById('bar-waste').style.height = `${(waste / 10) * 180}px`;

  // Generate Personalized Advisory Tips based on largest emission vectors
  const recContainer = document.getElementById('recommendations-container');
  recContainer.innerHTML = '';

  const tips = [];
  if (travel > 12) {
    tips.push('<strong>Travel Tip:</strong> Transition to cycling, public transport, or EV alternatives. Carpooling reduces daily travel footprint significantly.');
  }
  if (energy > 10) {
    tips.push('<strong>Energy Tip:</strong> Insulate home windows, transition to high-efficiency LED lights, and configure smart thermostats to save power.');
  }
  if (food > 6) {
    tips.push('<strong>Diet Tip:</strong> Cutting down red meat consumption by 50% and replacing it with plant-based alternatives reduces food footprints heavily.');
  }
  if (waste > 4) {
    tips.push('<strong>Waste Tip:</strong> Avoid single-use packaging. Implement comprehensive organic composting and follow local recycling structures.');
  }

  if (tips.length === 0) {
    tips.push('🌟 Great balance! All categories are inside sustainable daily ranges. Keep maintaining your habits.');
  }

  tips.forEach(tip => {
    const el = document.createElement('div');
    el.className = 'rec-item';
    el.innerHTML = tip;
    recContainer.appendChild(el);
  });
}

// --------------------------------------------------------------------------
// DASHBOARD & LEADERBOARD DATA SERVICES
// --------------------------------------------------------------------------
async function submitFootprint(event) {
  event.preventDefault();
  if (!token) return;

  const travel = parseFloat(document.getElementById('sl-travel').value);
  const energy = parseFloat(document.getElementById('sl-energy').value);
  const food = parseFloat(document.getElementById('sl-food').value);
  const waste = parseFloat(document.getElementById('sl-waste').value);

  try {
    const res = await fetch(`${API_BASE}/footprints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ travel, energy, food, waste })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to submit entry.');
      return;
    }

    // Update statistics panel immediately
    document.getElementById('lbl-curr-footprint').textContent = `${data.data.totalFootprint.toFixed(1)} kg`;
    document.getElementById('lbl-curr-savings').textContent = `${data.data.dailySavings} kg`;
    document.getElementById('lbl-cum-savings').textContent = `${data.data.cumulativeSavings} kg`;

    // Refresh Leaderboard
    fetchLeaderboard();
  } catch (err) {
    console.error('[Footprint Submit Error]', err);
    alert('Network error submitting daily log.');
  }
}

async function fetchUserHistory() {
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/footprints/history`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok || !data.success) return;

    if (data.history.length > 0) {
      const lastEntry = data.history[0];
      const baseDailyAvg = 16.0;
      
      // Load last log values back into sliders
      document.getElementById('sl-travel').value = lastEntry.travel_score;
      document.getElementById('sl-energy').value = lastEntry.energy_score;
      document.getElementById('sl-food').value = lastEntry.food_score;
      document.getElementById('sl-waste').value = lastEntry.waste_score;
      updateCalculations();

      // Sum metrics
      const currentFootprint = lastEntry.total_footprint;
      const currentSavings = baseDailyAvg - currentFootprint;
      const cumulativeSavings = data.history.reduce((sum, log) => sum + (baseDailyAvg - log.total_footprint), 0);

      document.getElementById('lbl-curr-footprint').textContent = `${currentFootprint.toFixed(1)} kg`;
      document.getElementById('lbl-curr-savings').textContent = `${currentSavings.toFixed(1)} kg`;
      document.getElementById('lbl-cum-savings').textContent = `${cumulativeSavings.toFixed(1)} kg`;
    }
  } catch (err) {
    console.error('[History Load Error]', err);
  }
}

async function fetchLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      container.innerHTML = '<p style="text-align: center; color: red;">Error loading leaderboard.</p>';
      return;
    }

    container.innerHTML = '';
    
    if (data.leaderboard.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No entries logged yet.</p>';
      return;
    }

    data.leaderboard.forEach((user, index) => {
      const item = document.createElement('div');
      item.className = 'leaderboard-item';
      
      const rankClass = index < 3 ? `top-${index + 1}` : '';
      
      item.innerHTML = `
        <div class="rank-user">
          <div class="rank-badge ${rankClass}">${index + 1}</div>
          <span class="rank-username">${user.username}</span>
        </div>
        <span class="rank-score">${parseFloat(user.score).toFixed(1)} kg saved</span>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    console.error('[Leaderboard HTTP Error]', err);
    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No connection to cache server.</p>';
  }
}

function resetMetrics() {
  document.getElementById('lbl-curr-footprint').textContent = '0.0 kg';
  document.getElementById('lbl-curr-savings').textContent = '0.0 kg';
  document.getElementById('lbl-cum-savings').textContent = '0.0 kg';
}
