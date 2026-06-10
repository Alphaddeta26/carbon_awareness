document.addEventListener('DOMContentLoaded', () => {
  initPoster3D();
  initEcoCalculator();
  initVanMitraGame();
  initRevealAnimations();
});

/* ==========================================================================
   1. Interactive 3D Poster Parallax Effect
   ========================================================================== */
function initPoster3D() {
  const card = document.querySelector('.poster-card');
  const wrapper = document.querySelector('.poster-wrapper');
  
  if (!card || !wrapper) return;

  wrapper.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left; // x coordinate inside the element
    const y = e.clientY - rect.top;  // y coordinate inside the element
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Calculate rotation degree based on mouse position relative to center
    // Max rotation 15 degrees
    const rotateX = ((centerY - y) / centerY) * 15;
    const rotateY = ((x - centerX) / centerX) * 15;
    
    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05, 1.05, 1.05)`;
  });

  wrapper.addEventListener('mouseleave', () => {
    card.style.transform = 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
  });
}

/* ==========================================================================
   2. Dynamic Eco-Calculator
   ========================================================================== */
function initEcoCalculator() {
  const sliderAravalli = document.getElementById('sl-aravalli');
  const sliderJica = document.getElementById('sl-jica');
  const sliderSolar = document.getElementById('sl-solar');
  
  const valAravalli = document.getElementById('val-aravalli');
  const valJica = document.getElementById('val-jica');
  const valSolar = document.getElementById('val-solar');
  
  const outCarbon = document.getElementById('out-carbon');
  const outWater = document.getElementById('out-water');
  const outJobs = document.getElementById('out-jobs');
  const outEnergy = document.getElementById('out-energy');
  
  const ratingFill = document.querySelector('.rating-fill');
  const ratingLabel = document.getElementById('rating-lbl');

  if (!sliderAravalli || !sliderJica || !sliderSolar) return;

  // Initial values
  let currentStats = { carbon: 0, water: 0, jobs: 0, energy: 0 };

  const updateCalculations = () => {
    const aravalliAcres = parseInt(sliderAravalli.value);
    const jicaAcres = parseInt(sliderJica.value);
    const solarMw = parseInt(sliderSolar.value);

    // Update slider UI value displays
    valAravalli.textContent = `${aravalliAcres.toLocaleString()} Acres`;
    valJica.textContent = `${jicaAcres.toLocaleString()} Acres`;
    valSolar.textContent = `${solarMw.toLocaleString()} MW`;

    // Calculations:
    // Aravalli: 2.5 metric tons CO2 / acre/yr, 0.4 "Van Mitras" jobs / acre
    // JICA Horticulture: 1,200 cubic meters water saved / acre/yr, 0.8 farm jobs / acre
    // Solar: 800 tons CO2 mitigated / MW, 750 homes powered / MW
    const targetCarbon = (aravalliAcres * 2.5) + (solarMw * 800);
    const targetWater = (jicaAcres * 1200);
    const targetJobs = Math.round((aravalliAcres * 0.4) + (jicaAcres * 0.8) + (solarMw * 3.5));
    const targetEnergy = (solarMw * 750);

    // Smooth count animations to new values
    animateValue(outCarbon, currentStats.carbon, targetCarbon, 800, 't');
    animateValue(outWater, currentStats.water, targetWater, 800, 'm³');
    animateValue(outJobs, currentStats.jobs, targetJobs, 800, '');
    animateValue(outEnergy, currentStats.energy, targetEnergy, 800, ' homes');

    currentStats = { carbon: targetCarbon, water: targetWater, jobs: targetJobs, energy: targetEnergy };

    // Calculate Sustainability Score (0 - 100)
    const maxAravalli = parseInt(sliderAravalli.max);
    const maxJica = parseInt(sliderJica.max);
    const maxSolar = parseInt(sliderSolar.max);

    const score = Math.round(
      ((aravalliAcres / maxAravalli) * 35) + 
      ((jicaAcres / maxJica) * 35) + 
      ((solarMw / maxSolar) * 30)
    );

    ratingFill.style.width = `${score}%`;

    // Update Rating Descriptive Text
    if (score < 25) {
      ratingLabel.textContent = 'Initial Footprint';
      ratingLabel.style.color = 'var(--text-secondary)';
    } else if (score < 50) {
      ratingLabel.textContent = 'Sustainable Pioneer';
      ratingLabel.style.color = '#3b82f6';
    } else if (score < 80) {
      ratingLabel.textContent = 'Green Guardian';
      ratingLabel.style.color = 'var(--accent-gold)';
    } else {
      ratingLabel.textContent = 'Net-Zero Champion';
      ratingLabel.style.color = 'var(--accent-green)';
    }
  };

  // Attach event listeners
  [sliderAravalli, sliderJica, sliderSolar].forEach(slider => {
    slider.addEventListener('input', updateCalculations);
  });

  // Init
  updateCalculations();
}

// Utility to animate count-up/down numbers
function animateValue(obj, start, end, duration, suffix = '') {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const currentValue = Math.floor(progress * (end - start) + start);
    
    // Formatting values beautifully
    if (currentValue >= 1000000) {
      obj.innerHTML = (currentValue / 1000000).toFixed(1) + 'M' + suffix;
    } else if (currentValue >= 1000) {
      obj.innerHTML = (currentValue / 1000).toFixed(1) + 'k' + suffix;
    } else {
      obj.innerHTML = currentValue.toLocaleString() + suffix;
    }

    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      // Final lock in case of rounding errors
      if (end >= 1000000) {
        obj.innerHTML = (end / 1000000).toFixed(1) + 'M' + suffix;
      } else if (end >= 1000) {
        obj.innerHTML = (end / 1000).toFixed(1) + 'k' + suffix;
      } else {
        obj.innerHTML = end.toLocaleString() + suffix;
      }
    }
  };
  window.requestAnimationFrame(step);
}

/* ==========================================================================
   3. "Van Mitra" Mini Game Simulator
   ========================================================================== */
function initVanMitraGame() {
  const gameBody = document.getElementById('game-body');
  
  // Game states: Ecology, Agriculture, Economy (Start at 50%)
  let state = {
    ecology: 50,
    agriculture: 50,
    economy: 50,
    week: 1
  };

  const scenarios = [
    {
      week: 1,
      title: "The Ground Water Squeeze",
      text: "A sharp drop in rainfall leaves southern Haryana facing a groundwater crisis. Local farming associations are demanding approval to dig deeper borewells, but hydrologists warn it will collapse the water table in the sensitive Aravalli region.",
      choices: [
        {
          title: "Approve Deeper Borewells",
          desc: "Relieve immediate farm water needs. Fosters short-term crop yields but depletes state water table.",
          effectText: "Agriculture +20, Ecology -20, Economy +5",
          action: () => {
            adjustState(20, -20, 5);
          }
        },
        {
          title: "Enforce Micro-Irrigation & Subsidize Harvesting",
          desc: "Mandate water-saving techniques under JICA scheme, providing subsidies. Harder on immediate farmer budgets but preserves hydrology.",
          effectText: "Agriculture -10, Ecology +25, Economy -10",
          action: () => {
            adjustState(-10, 25, -10);
          }
        }
      ]
    },
    {
      week: 2,
      title: "The Aravalli Logistics Corridor",
      text: "A major e-commerce conglomerate proposes constructing a massive, multi-billion dollar transit hub on the border of the Gurugram Aravalli eco-shield. It will create thousands of jobs but clear native forest zones.",
      choices: [
        {
          title: "Approve the Logistics Hub",
          desc: "Boost state economic indexes and create local employment. Displaces local wildlife and breaks the Green Wall.",
          effectText: "Economy +30, Ecology -25, Agriculture -5",
          action: () => {
            adjustState(-5, -25, 30);
          }
        },
        {
          title: "Block Project & Establish Eco-Tourism Reserve",
          desc: "Protect the forest corridor. Incentivize organic farming and guided eco-tours instead, drawing lower immediate revenue.",
          effectText: "Economy -5, Ecology +30, Agriculture +5",
          action: () => {
            adjustState(5, 30, -5);
          }
        }
      ]
    },
    {
      week: 3,
      title: "The Stubble Smog Crisis",
      text: "Post-harvest season arrives and crop residue burning rises. High smoke pollution affects neighboring cities. Farmers ask for subsidies to purchase crop residue machinery, while urban councils demand heavy enforcement fines.",
      choices: [
        {
          title: "Deploy HARSAC Satellite Patrol & Fine Farmers",
          desc: "Use high-resolution satellite imagery to locate stubble burning and fine violators. Reduces pollution rapidly but strains farmer relationships.",
          effectText: "Agriculture -20, Ecology +25, Economy -5",
          action: () => {
            adjustState(-20, 25, -5);
          }
        },
        {
          title: "Distribute Subsidized Residue Management Gear",
          desc: "Provide Happy Seeders and bio-decomposers. Enhances soil nutrition and stops fires, but burdens state treasury.",
          effectText: "Agriculture +20, Ecology +15, Economy -25",
          action: () => {
            adjustState(20, 15, -25);
          }
        }
      ]
    },
    {
      week: 4,
      title: "Future Power Allocation",
      text: "Industrial development is creating power deficits in Haryana. You have a budget surplus. Do you build a traditional coal plant to guarantee cheap industrial power, or build solar parks in the southern districts?",
      choices: [
        {
          title: "Construct a Coal-Fired Power Plant",
          desc: "Ensure cheap, uninterrupted energy for expanding factories. Greatly increases emissions and offsets reforestation efforts.",
          effectText: "Economy +30, Ecology -30, Agriculture -10",
          action: () => {
            adjustState(-10, -30, 30);
          }
        },
        {
          title: "Fund Distributed Solar Parks & FPO Microgrids",
          desc: "Build solar fields while empowering agricultural clusters to run their own solar-powered irrigation grids.",
          effectText: "Economy +10, Ecology +20, Agriculture +15",
          action: () => {
            adjustState(15, 20, 10);
          }
        }
      ]
    }
  ];

  const updateRings = () => {
    // Circumference of a circle with r=28 is 2 * pi * 28 = 175.93
    const circumference = 175.93;
    
    const ecoRing = document.getElementById('ring-eco');
    const agrRing = document.getElementById('ring-agr');
    const devRing = document.getElementById('ring-dev');
    
    if (ecoRing) ecoRing.style.strokeDashoffset = circumference - (state.ecology / 100) * circumference;
    if (agrRing) agrRing.style.strokeDashoffset = circumference - (state.agriculture / 100) * circumference;
    if (devRing) devRing.style.strokeDashoffset = circumference - (state.economy / 100) * circumference;
    
    document.getElementById('txt-eco').textContent = `${state.ecology}%`;
    document.getElementById('txt-agr').textContent = `${state.agriculture}%`;
    document.getElementById('txt-dev').textContent = `${state.economy}%`;
  };

  const adjustState = (agr, eco, econ) => {
    state.agriculture = Math.max(0, Math.min(100, state.agriculture + agr));
    state.ecology = Math.max(0, Math.min(100, state.ecology + eco));
    state.economy = Math.max(0, Math.min(100, state.economy + econ));
    state.week += 1;
    
    updateRings();
    
    // Check Failure Condition
    if (state.agriculture < 20) {
      endGame("Farmer Revolt", "Farming systems collapsed due to poor policies and extreme resource shortages. Haryana's fields lie barren, and mass protests stall state operations.");
    } else if (state.ecology < 20) {
      endGame("Ecological Collapse", "Deforestation, depleting groundwater, and industrial pollution triggered a severe climate crisis. Water tables are empty, and thick smog blankets the region.");
    } else if (state.economy < 20) {
      endGame("Economic Bankruptcy", "State budgets collapsed under heavy subsidies and zero industrial progression. Public works are halted and infrastructure development has frozen.");
    } else {
      nextStep();
    }
  };

  const nextStep = () => {
    if (state.week > scenarios.length) {
      // Game completed successfully!
      const totalScore = state.agriculture + state.ecology + state.economy;
      let title = "";
      let text = "";

      if (totalScore >= 220) {
        title = "Sustainable Sage of Haryana";
        text = `Incredible! You balanced the state's agriculture, ecology, and economy with mastery. The Aravalli green belt is lush, groundwater is returning, and eco-friendly hubs are thriving under your guidance. Final Balance: Agriculture ${state.agriculture}%, Ecology ${state.ecology}%, Economy ${state.economy}%.`;
      } else if (totalScore >= 160) {
        title = "Pragmatic Architect";
        text = `You steered the state through major crises, maintaining a stable balance. While some trade-offs had to be made, Haryana continues to scale sustainably. Final Balance: Agriculture ${state.agriculture}%, Ecology ${state.ecology}%, Economy ${state.economy}%.`;
      } else {
        title = "Unbalanced Administrator";
        text = `You completed the term, but the state remains heavily polarized. Either agricultural struggles, environmental degradation, or financial stagnation are creating long-term vulnerabilities. Final Balance: Agriculture ${state.agriculture}%, Ecology ${state.ecology}%, Economy ${state.economy}%.`;
      }
      
      endGame(title, text, true);
    } else {
      renderScenario(scenarios[state.week - 1]);
    }
  };

  const renderScenario = (sc) => {
    gameBody.innerHTML = `
      <div class="scenario-card">
        <div class="scenario-week">Week ${sc.week} of 4: ${sc.title}</div>
        <div class="scenario-text">${sc.text}</div>
      </div>
      <div class="choices-container">
        <button class="choice-btn" id="btn-choice-0">
          <span class="choice-title">${sc.choices[0].title}</span>
          <p>${sc.choices[0].desc}</p>
          <span class="choice-effect">${sc.choices[0].effectText}</span>
        </button>
        <button class="choice-btn" id="btn-choice-1">
          <span class="choice-title">${sc.choices[1].title}</span>
          <p>${sc.choices[1].desc}</p>
          <span class="choice-effect">${sc.choices[1].effectText}</span>
        </button>
      </div>
    `;
    
    document.getElementById('btn-choice-0').addEventListener('click', sc.choices[0].action);
    document.getElementById('btn-choice-1').addEventListener('click', sc.choices[1].action);
  };

  const endGame = (title, text, victory = false) => {
    gameBody.innerHTML = `
      <div class="game-over-screen">
        <h3 class="game-over-title">${victory ? 'VICTORY' : 'CRISIS TRIGGERED'}</h3>
        <h4 style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${title}</h4>
        <p style="max-width: 600px; margin: 0 auto; line-height: 1.6;">${text}</p>
        <button class="btn btn-primary" id="btn-restart" style="margin-top: 1.5rem;">
          Restart Term
        </button>
      </div>
    `;
    
    document.getElementById('btn-restart').addEventListener('click', () => {
      state = { ecology: 50, agriculture: 50, economy: 50, week: 1 };
      updateRings();
      nextStep();
    });
  };

  // Init Game
  updateRings();
  nextStep();
}

/* ==========================================================================
   4. Scroll Reveal Animations
   ========================================================================== */
function initRevealAnimations() {
  const reveals = document.querySelectorAll('.project-card, .calculator-container, .game-container');
  
  const revealOnScroll = () => {
    const windowHeight = window.innerHeight;
    reveals.forEach(el => {
      const elementTop = el.getBoundingClientRect().top;
      const elementVisible = 100;
      
      if (elementTop < windowHeight - elementVisible) {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }
    });
  };

  // Set initial state
  reveals.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(40px)';
    el.style.transition = 'opacity 0.8s ease, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
  });

  window.addEventListener('scroll', revealOnScroll);
  // Trigger once initially
  revealOnScroll();
}
