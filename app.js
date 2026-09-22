(() => {
  'use strict';

  const CONFIG = {
    worldRadius: 500, initialParticles: 600, maxParticles: 3000,
    interactionRadius: 35, repulsionRadius: 8, lifeRadius: 28,
    attraction: 0.012, repulsion: 0.18, orbit: 0.008,
    boundary: 0.25, friction: 0.985, maxSpeed: 2.5,
    lifeInterval: 0.5, birthProbability: 0.04,
    corpseLifetime: 8, nutrientRadius: 10, absorbRate: 0.08,
    aging: true
  };
  const TICK = 1 / 60;
  const canvas = document.querySelector('#simulationCanvas');
  const ctx = canvas.getContext('2d');
  const trailCanvas = document.querySelector('#trailCanvas');
  const trailCtx = trailCanvas.getContext('2d');
  const chart = document.querySelector('#populationChart');
  const chartCtx = chart.getContext('2d');

  let particles = [], corpses = [], grid = new Map(), nextId = 1;
  let running = true, speed = 1, accumulator = 0, lastFrame = performance.now(), simulationTime = 0;
  let seed = 1, random = Math.random, birthsWindow = [], deathsWindow = [], history = [];
  let initialPopulation = CONFIG.initialParticles, averageNeighbors = 0, lastStatsUpdate = 0;
  let fpsSamples = [], dragging = false, dragLast = null;

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randomSeed() { return Math.floor(Math.random() * 0xffffffff) >>> 0; }
  function makeParticle(x, y, energy = 1, vx, vy) {
    const angle = random() * Math.PI * 2;
    const velocity = random() * .5;
    return { id: nextId++, x, y, vx: vx ?? Math.cos(angle) * velocity, vy: vy ?? Math.sin(angle) * velocity, energy, age: 0, lifeTimer: random() * CONFIG.lifeInterval, neighbors: 0 };
  }
  function initialize(newSeed = seed || randomSeed()) {
    seed = newSeed >>> 0; random = mulberry32(seed); nextId = 1; particles = []; corpses = [];
    simulationTime = 0; accumulator = 0; history = []; birthsWindow = []; deathsWindow = []; averageNeighbors = 0;
    for (let i = 0; i < CONFIG.initialParticles; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * CONFIG.worldRadius * .91;
      particles.push(makeParticle(Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    initialPopulation = particles.length;
    updateSeedUI(); updateStats(true); document.querySelector('#extinction').classList.remove('visible');
  }

  const cellKey = (x, y) => `${x},${y}`;
  function rebuildGrid() {
    grid.clear();
    for (const p of particles) {
      const gx = Math.floor(p.x / CONFIG.interactionRadius), gy = Math.floor(p.y / CONFIG.interactionRadius);
      const key = cellKey(gx, gy);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
  }
  function nearby(p, radius = CONFIG.interactionRadius) {
    const found = [], cell = CONFIG.interactionRadius;
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), range = Math.ceil(radius / cell);
    const radiusSq = radius * radius;
    for (let yy = gy - range; yy <= gy + range; yy++) for (let xx = gx - range; xx <= gx + range; xx++) {
      const bucket = grid.get(cellKey(xx, yy)); if (!bucket) continue;
      for (const other of bucket) {
        if (other === p) continue;
        const dx = other.x-p.x, dy = other.y-p.y;
        if (dx*dx + dy*dy < radiusSq) found.push(other);
      }
    }
    return found;
  }

  function tick() {
    rebuildGrid();
    const births = [], deaths = [];
    let neighborTotal = 0;
    for (const p of particles) {
      const neighbors = nearby(p);
      let fx = 0, fy = 0, cx = 0, cy = 0, lifeCount = 0;
      for (const q of neighbors) {
        const dx = q.x-p.x, dy = q.y-p.y;
        const d2 = dx*dx + dy*dy;
        if (d2 < .0001) { fx += (random()-.5)*CONFIG.repulsion; fy += (random()-.5)*CONFIG.repulsion; continue; }
        const d = Math.sqrt(d2), nx = dx/d, ny = dy/d;
        if (d < CONFIG.lifeRadius) lifeCount++;
        if (d < CONFIG.repulsionRadius) {
          const force = CONFIG.repulsion * (1-d/CONFIG.repulsionRadius);
          fx -= nx*force; fy -= ny*force;
        } else {
          const force = CONFIG.attraction * Math.min(1, (d-CONFIG.repulsionRadius)/12);
          fx += nx*force; fy += ny*force;
        }
        cx += q.x; cy += q.y;
      }
      if (neighbors.length) {
        cx = cx/neighbors.length-p.x; cy = cy/neighbors.length-p.y;
        const len = Math.hypot(cx,cy);
        if (len) { fx += (-cy/len)*CONFIG.orbit; fy += (cx/len)*CONFIG.orbit; }
      }
      p.neighbors = lifeCount; neighborTotal += lifeCount;
      const r = Math.hypot(p.x,p.y);
      if (r > CONFIG.worldRadius*.85) {
        const t = Math.min(1,(r-CONFIG.worldRadius*.85)/(CONFIG.worldRadius*.15));
        fx -= (p.x/r)*CONFIG.boundary*t*t; fy -= (p.y/r)*CONFIG.boundary*t*t;
      }
      p.vx = (p.vx+fx)*CONFIG.friction; p.vy = (p.vy+fy)*CONFIG.friction;
      const v = Math.hypot(p.vx,p.vy); if (v > CONFIG.maxSpeed) { p.vx=p.vx/v*CONFIG.maxSpeed; p.vy=p.vy/v*CONFIG.maxSpeed; }
      p.x += p.vx; p.y += p.vy;
      const nr = Math.hypot(p.x,p.y);
      if (nr > CONFIG.worldRadius) {
        const nx=p.x/nr, ny=p.y/nr; p.x=nx*(CONFIG.worldRadius-1); p.y=ny*(CONFIG.worldRadius-1);
        const outward=p.vx*nx+p.vy*ny; if(outward>0){p.vx-=outward*nx;p.vy-=outward*ny;}
      }
      absorbNutrients(p);
      p.age += TICK; if (CONFIG.aging) p.energy -= .002*TICK;
      p.lifeTimer += TICK;
      if (p.lifeTimer >= CONFIG.lifeInterval) {
        p.lifeTimer -= CONFIG.lifeInterval;
        if (lifeCount <= 2) p.energy -= .10;
        else if (lifeCount === 3) p.energy -= .02;
        else if (lifeCount <= 9) p.energy = Math.min(1,p.energy+.015);
        else if (lifeCount <= 12) p.energy -= .04;
        else p.energy -= .15;
        if (lifeCount >= 6 && lifeCount <= 8 && p.energy >= .75 && particles.length+births.length < CONFIG.maxParticles && random() < CONFIG.birthProbability) births.push(p);
      }
      if (p.energy <= 0) deaths.push(p);
    }
    averageNeighbors = particles.length ? neighborTotal/particles.length : 0;
    for (const parent of births) reproduce(parent);
    if (deaths.length) {
      const deadIds = new Set(deaths.map(p=>p.id));
      for (const p of deaths) corpses.push({x:p.x,y:p.y,energy:Math.max(.08,.35+p.energy),age:0});
      particles = particles.filter(p=>!deadIds.has(p.id));
      for(let i=0;i<deaths.length;i++) deathsWindow.push(simulationTime);
    }
    for (const c of corpses) c.age += TICK;
    corpses = corpses.filter(c=>c.age<CONFIG.corpseLifetime && c.energy>.001);
    simulationTime += TICK;
    if (!particles.length) { running=false; syncPlayUI(); document.querySelector('#extinction').classList.add('visible'); }
  }

  function reproduce(parent) {
    const angle=random()*Math.PI*2, distance=4+random()*4;
    const x=parent.x+Math.cos(angle)*distance,y=parent.y+Math.sin(angle)*distance;
    if(x*x+y*y>=CONFIG.worldRadius*CONFIG.worldRadius)return;
    const energy=parent.energy; parent.energy=energy*.55;
    particles.push(makeParticle(x,y,energy*.45,parent.vx+(random()-.5)*.4,parent.vy+(random()-.5)*.4));
    birthsWindow.push(simulationTime);
  }
  function absorbNutrients(p) {
    for(const c of corpses){
      const dx=c.x-p.x,dy=c.y-p.y;
      if(dx*dx+dy*dy<CONFIG.nutrientRadius*CONFIG.nutrientRadius && p.energy<1){
        const amount=Math.min(CONFIG.absorbRate*TICK,c.energy,1-p.energy);p.energy+=amount;c.energy-=amount;
      }
    }
  }

  function resizeCanvas() {
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=trailCanvas.width=Math.round(rect.width*dpr);canvas.height=trailCanvas.height=Math.round(rect.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);trailCtx.setTransform(dpr,0,0,dpr,0,0);
  }
  function render() {
    const w=canvas.clientWidth,h=canvas.clientHeight,cx=w/2,cy=h/2,r=Math.min(w,h)*.465,scale=r/CONFIG.worldRadius;
    ctx.clearRect(0,0,w,h);
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r);glow.addColorStop(0,'rgba(26,66,52,.18)');glow.addColorStop(.72,'rgba(12,38,31,.12)');glow.addColorStop(1,'rgba(2,10,9,.42)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(145,215,186,.17)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(145,215,186,.055)';ctx.setLineDash([2,8]);ctx.beginPath();ctx.arc(cx,cy,r*.85,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(143,157,151,.35)';
    for(const c of corpses){const life=1-c.age/CONFIG.corpseLifetime;ctx.globalAlpha=Math.max(0,life)*.5;ctx.beginPath();ctx.arc(cx+c.x*scale,cy+c.y*scale,Math.max(.45,1.7*life),0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    ctx.shadowColor='rgba(132,255,196,.6)';ctx.shadowBlur=4;
    for(const p of particles){const e=Math.max(0,p.energy),light=45+e*35;ctx.fillStyle=`hsl(${145+e*12} 65% ${light}%)`;ctx.globalAlpha=.38+e*.62;ctx.beginPath();ctx.arc(cx+p.x*scale,cy+p.y*scale,1.15+e*.65,0,Math.PI*2);ctx.fill();}
    ctx.shadowBlur=0;ctx.globalAlpha=1;
  }
  function drawChart() {
    const rect=chart.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(chart.width!==Math.round(rect.width*dpr)){chart.width=Math.round(rect.width*dpr);chart.height=Math.round(rect.height*dpr);}
    chartCtx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;chartCtx.clearRect(0,0,w,h);
    chartCtx.strokeStyle='rgba(180,220,205,.07)';chartCtx.lineWidth=1;for(let i=1;i<4;i++){chartCtx.beginPath();chartCtx.moveTo(0,h*i/4);chartCtx.lineTo(w,h*i/4);chartCtx.stroke();}
    if(history.length<2)return;const max=Math.max(CONFIG.initialParticles,...history.map(v=>v.living));
    const path=(key,color)=>{chartCtx.beginPath();history.forEach((v,i)=>{const x=i/(history.length-1)*w,y=h-5-v[key]/max*(h-10);i?chartCtx.lineTo(x,y):chartCtx.moveTo(x,y);});chartCtx.strokeStyle=color;chartCtx.lineWidth=1.2;chartCtx.stroke();};
    path('corpses','rgba(218,156,103,.65)');path('living','rgba(133,242,190,.9)');
  }
  function updateStats(force=false) {
    if(!force && simulationTime-lastStatsUpdate<.5)return;lastStatsUpdate=simulationTime;
    const cutoff=simulationTime-1;birthsWindow=birthsWindow.filter(t=>t>=cutoff);deathsWindow=deathsWindow.filter(t=>t>=cutoff);
    const avg=particles.length?particles.reduce((s,p)=>s+p.energy,0)/particles.length:0;
    document.querySelector('#livingCount').textContent=particles.length.toLocaleString();document.querySelector('#corpseCount').textContent=corpses.length.toLocaleString();
    document.querySelector('#averageEnergy').textContent=avg.toFixed(2);document.querySelector('#birthRate').textContent=birthsWindow.length.toFixed(1);document.querySelector('#deathRate').textContent=deathsWindow.length.toFixed(1);
    document.querySelector('#averageNeighbors').textContent=averageNeighbors.toFixed(1);document.querySelector('#populationDelta').innerHTML=`● &nbsp; ${particles.length>=initialPopulation?'+':''}${((particles.length/initialPopulation-1)*100).toFixed(1)}%`;
    const mins=Math.floor(simulationTime/60),secs=Math.floor(simulationTime%60);document.querySelector('#simulationTime').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;document.querySelector('#timeDetail').textContent=`${String(mins).padStart(2,'0')}:${(simulationTime%60).toFixed(1).padStart(4,'0')}`;
    history.push({living:particles.length,corpses:corpses.length});if(history.length>120)history.shift();drawChart();
  }
  function loop(now) {
    const delta=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;fpsSamples.push(1/Math.max(delta,.001));if(fpsSamples.length>30)fpsSamples.shift();
    if(running){accumulator+=delta*speed;let safety=0;while(accumulator>=TICK&&safety++<20){tick();accumulator-=TICK;}}
    render();updateStats();document.querySelector('#fps').textContent=`${Math.round(fpsSamples.reduce((a,b)=>a+b,0)/fpsSamples.length)} FPS`;requestAnimationFrame(loop);
  }

  function syncPlayUI(){document.querySelector('#playLabel').textContent=running?'PAUSE':'START';document.querySelector('.pause-icon').classList.toggle('play',!running);document.querySelector('#runStatus').textContent=running?'SIMULATION RUNNING':'SIMULATION PAUSED';document.querySelector('.status-dot').classList.toggle('paused',!running);}
  function updateSeedUI(){const display=seed.toString(16).toUpperCase().padStart(8,'0');document.querySelector('#seedTop').textContent=display;document.querySelector('#seedDetail').textContent=display;}
  function addAtPointer(event, count=4){const rect=canvas.getBoundingClientRect(),r=Math.min(rect.width,rect.height)*.465,scale=CONFIG.worldRadius/r,x=(event.clientX-rect.left-rect.width/2)*scale,y=(event.clientY-rect.top-rect.height/2)*scale;if(x*x+y*y>CONFIG.worldRadius*CONFIG.worldRadius)return;for(let i=0;i<count&&particles.length<CONFIG.maxParticles;i++){const a=random()*Math.PI*2,d=random()*6;particles.push(makeParticle(x+Math.cos(a)*d,y+Math.sin(a)*d));}}

  document.querySelector('#playButton').addEventListener('click',()=>{running=!running;syncPlayUI();});
  document.querySelector('#resetButton').addEventListener('click',()=>{initialize(seed);running=true;syncPlayUI();});
  document.querySelector('#randomButton').addEventListener('click',()=>{initialize(randomSeed());running=true;syncPlayUI();});
  document.querySelector('#extinctionRestart').addEventListener('click',()=>{initialize(seed);running=true;syncPlayUI();});
  document.querySelector('#speedOptions').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;speed=Number(b.dataset.speed);document.querySelectorAll('#speedOptions button').forEach(x=>x.classList.toggle('active',x===b));document.querySelector('#speedOutput').textContent=`${speed.toFixed(1)}×`;});
  const sliderConfig=[['attraction','attraction',v=>Number(v).toFixed(3)],['repulsion','repulsion',v=>Number(v).toFixed(3)],['orbit','orbit',v=>Number(v).toFixed(3)],['birth','birthProbability',v=>`${Math.round(v*100)}%`]];
  function syncSliders(){for(const[id,key,format]of sliderConfig){const el=document.querySelector(`#${id}`);el.value=CONFIG[key];el.style.setProperty('--fill',`${(el.value-el.min)/(el.max-el.min)*100}%`);document.querySelector(`#${id}Value`).textContent=format(el.value);}}
  for(const[id,key,format]of sliderConfig){document.querySelector(`#${id}`).addEventListener('input',e=>{CONFIG[key]=Number(e.target.value);e.target.style.setProperty('--fill',`${(e.target.value-e.target.min)/(e.target.max-e.target.min)*100}%`);document.querySelector(`#${id}Value`).textContent=format(e.target.value);});}
  document.querySelector('#aging').addEventListener('change',e=>CONFIG.aging=e.target.checked);
  document.querySelector('#defaultsButton').addEventListener('click',()=>{CONFIG.attraction=.012;CONFIG.repulsion=.18;CONFIG.orbit=.008;CONFIG.birthProbability=.04;CONFIG.aging=true;document.querySelector('#aging').checked=true;syncSliders();});
  document.querySelector('#debugToggle').addEventListener('click',e=>{const content=document.querySelector('#debugContent'),show=content.hidden;content.hidden=!show;e.target.classList.toggle('active',show);e.target.textContent=show?'DATA ON':'DATA OFF';});
  document.querySelector('#copySeed').addEventListener('click',async e=>{await navigator.clipboard?.writeText(document.querySelector('#seedDetail').textContent);e.target.textContent='COPIED';setTimeout(()=>e.target.textContent='COPY',1000);});
  canvas.addEventListener('pointerdown',e=>{dragging=true;dragLast={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);addAtPointer(e,7);});
  canvas.addEventListener('pointermove',e=>{const tip=document.querySelector('#canvasTip'),rect=canvas.getBoundingClientRect();tip.style.left=`${e.clientX-rect.left+12}px`;tip.style.top=`${e.clientY-rect.top+12}px`;if(dragging&&Math.hypot(e.clientX-dragLast.x,e.clientY-dragLast.y)>8){addAtPointer(e,3);dragLast={x:e.clientX,y:e.clientY};}});
  canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
  window.addEventListener('resize',resizeCanvas);
  resizeCanvas();syncSliders();initialize(randomSeed());requestAnimationFrame(loop);
})();
