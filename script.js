// QueueManager Website Scripts
document.addEventListener('DOMContentLoaded', function() {
    // Initialize AOS (Animate On Scroll)
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 800,
            easing: 'ease-in-out',
            once: true,
            offset: 100
        });
    }

    // Initialize particle background
    initParticles();
    
    // Initialize animations
    initAnimations();
    
    // Initialize demo functionality
    initDemo();
    
    // Initialize tab functionality
    initTabs();
    
    // Initialize smooth scrolling
    initSmoothScrolling();
    
    // Initialize counter animations
    initCounters();
    
    // Initialize queue demo animations
    initQueueDemo();
});

// Particle Background
function initParticles() {
    const particlesContainer = document.getElementById('particles');
    if (!particlesContainer) return;

    // Create floating particles
    for (let i = 0; i < 50; i++) {
        createParticle(particlesContainer);
    }
}

function createParticle(container) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    // Random properties
    const size = Math.random() * 3 + 1;
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const duration = Math.random() * 20 + 10;
    const delay = Math.random() * 5;
    
    particle.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        background: ${getRandomColor()};
        border-radius: 50%;
        left: ${x}%;
        top: ${y}%;
        animation: float ${duration}s ${delay}s infinite linear;
        opacity: 0.6;
    `;
    
    container.appendChild(particle);
}

function getRandomColor() {
    const colors = ['#00d4ff', '#00ff88', '#8b5cf6', '#ff6b6b', '#4ecdc4'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Add particle animation CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
        10% { opacity: 0.6; }
        90% { opacity: 0.6; }
        100% { transform: translateY(-100px) rotate(360deg); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Animations
function initAnimations() {
    // Animate hero title
    const titleLines = document.querySelectorAll('.title-line');
    titleLines.forEach((line, index) => {
        line.style.opacity = '0';
        line.style.transform = 'translateY(30px)';
        
        setTimeout(() => {
            line.style.transition = 'all 0.6s ease';
            line.style.opacity = '1';
            line.style.transform = 'translateY(0)';
        }, index * 200);
    });
    
    // Animate hero description
    const description = document.querySelector('.hero-description');
    if (description) {
        description.style.opacity = '0';
        description.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            description.style.transition = 'all 0.6s ease';
            description.style.opacity = '1';
            description.style.transform = 'translateY(0)';
        }, 800);
    }
    
    // Animate hero actions
    const actions = document.querySelector('.hero-actions');
    if (actions) {
        actions.style.opacity = '0';
        actions.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            actions.style.transition = 'all 0.6s ease';
            actions.style.opacity = '1';
            actions.style.transform = 'translateY(0)';
        }, 1200);
    }
}

// Demo Functionality
function initDemo() {
    const demoButtons = document.querySelectorAll('.demo-btn');
    const demoOutput = document.getElementById('demo-output');
    
    if (!demoButtons.length || !demoOutput) return;
    
    const demos = {
        basic: [
            { type: 'command', text: 'npm install re-queuejs' },
            { type: 'output', text: '✅ Package installed successfully' },
            { type: 'command', text: 'node demo.js' },
            { type: 'output', text: '🚀 Starting QueueManager...' },
            { type: 'output', text: '✅ Connected to Redis' },
            { type: 'output', text: '📦 Created queue: tasks' },
            { type: 'output', text: '📝 Added item: Process Data' },
            { type: 'output', text: '🔄 Processing item...' },
            { type: 'output', text: '✅ Completed: Process Data' }
        ],
        advanced: [
            { type: 'command', text: 'npm install re-queuejs' },
            { type: 'output', text: '✅ Package installed successfully' },
            { type: 'command', text: 'node advanced-demo.js' },
            { type: 'output', text: '🚀 Starting Advanced Features...' },
            { type: 'output', text: '✅ Connected to Redis' },
            { type: 'output', text: '📦 Created queue: tasks' },
            { type: 'output', text: '📡 Setting up event listeners...' },
            { type: 'output', text: '🎣 Before addToQueue: task-1' },
            { type: 'output', text: '📊 Item added with priority: 10' },
            { type: 'output', text: '🔔 Event: item:added - tasks' },
            { type: 'output', text: '🔄 Processing with hooks...' },
            { type: 'output', text: '✅ Completed: Advanced Task' }
        ],
        typescript: [
            { type: 'command', text: 'npm install re-queuejs' },
            { type: 'output', text: '✅ Package installed successfully' },
            { type: 'command', text: 'npx tsc --version' },
            { type: 'output', text: 'Version 5.9.2' },
            { type: 'command', text: 'npx ts-node demo.ts' },
            { type: 'output', text: '🚀 Starting TypeScript Demo...' },
            { type: 'output', text: '✅ TypeScript types loaded' },
            { type: 'output', text: '✅ Connected to Redis' },
            { type: 'output', text: '📦 Created queue: tasks' },
            { type: 'output', text: '📝 Added typed item: TaskData' },
            { type: 'output', text: '🔄 Processing with type safety...' },
            { type: 'output', text: '✅ Completed: TypeScript Task' }
        ]
    };
    
    demoButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Update active button
            demoButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Get demo type
            const demoType = button.dataset.demo;
            const demoData = demos[demoType] || demos.basic;
            
            // Clear and animate new content
            demoOutput.innerHTML = '';
            animateDemoOutput(demoOutput, demoData);
        });
    });
}

function animateDemoOutput(container, lines) {
    lines.forEach((line, index) => {
        setTimeout(() => {
            const lineElement = document.createElement('div');
            lineElement.className = 'output-line';
            
            if (line.type === 'command') {
                lineElement.innerHTML = `
                    <span class="prompt">$</span>
                    <span class="command">${line.text}</span>
                `;
            } else {
                lineElement.innerHTML = `
                    <span class="output">${line.text}</span>
                `;
            }
            
            container.appendChild(lineElement);
            
            // Scroll to bottom
            container.scrollTop = container.scrollHeight;
        }, index * 300);
    });
}

// Tab Functionality
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            
            // Update active button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update active content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetTab) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Smooth Scrolling
function initSmoothScrolling() {
    // Handle navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Counter Animations
function initCounters() {
    const counters = document.querySelectorAll('.stat-number');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    counters.forEach(counter => {
        observer.observe(counter);
    });
}

function animateCounter(element) {
    const target = parseInt(element.dataset.target);
    const duration = 2000;
    const start = performance.now();
    
    function updateCounter(currentTime) {
        const elapsed = currentTime - start;
        const progress = Math.min(elapsed / duration, 1);
        
        const current = Math.floor(progress * target);
        element.textContent = current.toLocaleString();
        
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
            element.textContent = target.toLocaleString();
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// Queue Demo Animations
function initQueueDemo() {
    const queueItems = document.querySelectorAll('.queue-item');
    
    // Animate queue items on scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                startQueueAnimation(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    queueItems.forEach(item => {
        observer.observe(item);
    });
}

function startQueueAnimation(item) {
    const delay = parseInt(item.dataset.delay) * 1000;
    
    setTimeout(() => {
        // Animate item appearance
        item.style.opacity = '1';
        item.style.transform = 'translateX(0)';
        
        // Animate progress bar
        const progressBar = item.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.animation = 'progress 3s ease-in-out infinite';
        }
        
        // Update status
        const status = item.querySelector('.item-status');
        if (status) {
            setTimeout(() => {
                status.textContent = 'Processing';
                status.style.color = 'var(--primary)';
            }, 1000);
            
            setTimeout(() => {
                status.textContent = 'Completed';
                status.style.color = 'var(--success)';
            }, 3000);
        }
    }, delay);
}

// Utility Functions
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Copy to clipboard functionality
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showNotification('Copied to clipboard!');
        });
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('Copied to clipboard!');
    }
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--primary);
        color: var(--background);
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 10000;
        animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Add notification animations
const notificationStyle = document.createElement('style');
notificationStyle.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(notificationStyle);

// Add copy buttons to code blocks
document.addEventListener('DOMContentLoaded', function() {
    const codeBlocks = document.querySelectorAll('pre code');
    
    codeBlocks.forEach(block => {
        const pre = block.parentElement;
        const button = document.createElement('button');
        button.className = 'copy-btn';
        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        button.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 8px;
            cursor: pointer;
            color: var(--text-muted);
            transition: all 0.2s ease;
            opacity: 0;
        `;
        
        pre.style.position = 'relative';
        pre.appendChild(button);
        
        pre.addEventListener('mouseenter', () => {
            button.style.opacity = '1';
        });
        
        pre.addEventListener('mouseleave', () => {
            button.style.opacity = '0';
        });
        
        button.addEventListener('click', () => {
            copyToClipboard(block.textContent);
            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
            `;
            button.style.color = 'var(--success)';
            
            setTimeout(() => {
                button.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                `;
                button.style.color = 'var(--text-muted)';
            }, 2000);
        });
    });
});

// Performance monitoring
function initPerformanceMonitoring() {
    // Monitor page load time
    window.addEventListener('load', () => {
        const loadTime = performance.now();
        console.log(`Page loaded in ${loadTime.toFixed(2)}ms`);
    });
    
    // Monitor scroll performance
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Throttle scroll events
        }, 16);
    });
}

// Initialize performance monitoring
initPerformanceMonitoring();

// Export functions for global use
window.scrollToSection = scrollToSection;
window.copyToClipboard = copyToClipboard;
