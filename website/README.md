# QueueManager Website

A futuristic, developer-focused single-page website for the QueueManager project. Built with modern web technologies and designed for GitHub Pages hosting.

## Design Features

- **Futuristic Dark Theme**: Space-inspired color palette with neon accents
- **Particle Background**: Animated floating particles for visual appeal
- **Interactive Demo**: Live terminal simulation with different examples
- **Responsive Design**: Mobile-first approach with smooth animations
- **TypeScript Support**: Highlights the project's TypeScript capabilities
- **Performance Focused**: Optimized for speed and user experience

## Technologies Used

- **HTML5**: Semantic markup with accessibility in mind
- **CSS3**: Modern CSS with custom properties, Grid, and Flexbox
- **JavaScript**: Vanilla JS with ES6+ features
- **Prism.js**: Syntax highlighting for code blocks
- **AOS**: Animate On Scroll library for smooth animations
- **Custom Animations**: Hand-crafted CSS animations and transitions

## File Structure

```
website/
├── index.html          # Main HTML file
├── styles.css          # All CSS styles
├── script.js           # JavaScript functionality
└── README.md           # This file
```

## Key Sections

1. **Hero Section**: Animated queue visualization with performance stats
2. **Features**: 6 key features with interactive cards and code examples
3. **Live Demo**: Interactive terminal with different demo scenarios
4. **Installation**: Tabbed installation instructions for different package managers
5. **Performance**: Animated performance metrics and statistics
6. **Footer**: Links and project information

## Color Palette

- **Primary**: Electric Blue (#00d4ff)
- **Secondary**: Neon Green (#00ff88)
- **Accent**: Purple (#8b5cf6)
- **Background**: Space Black (#0a0a0a)
- **Surface**: Dark Gray (#1a1a1a)
- **Text**: Light Gray (#e5e5e5)

## Interactive Features

- **Animated Counters**: Statistics that count up on scroll
- **Queue Demo**: Animated queue items with progress bars
- **Live Terminal**: Interactive demo with different scenarios
- **Smooth Scrolling**: Navigation with smooth scroll behavior
- **Copy to Clipboard**: Code blocks with copy functionality
- **Responsive Navigation**: Mobile-friendly navigation

## Deployment

### GitHub Pages

1. Push the website files to your repository
2. Enable GitHub Pages in repository settings
3. Select source branch (usually `main` or `gh-pages`)
4. Your site will be available at `https://username.github.io/repository-name`

### Local Development

1. Clone the repository
2. Navigate to the website directory
3. Open `index.html` in a browser or use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

## Responsive Design

The website is fully responsive with breakpoints at:
- **Mobile**: 480px and below
- **Tablet**: 768px and below
- **Desktop**: 769px and above

## Animations

- **Particle Background**: Floating particles with random colors
- **Hero Title**: Typewriter effect with staggered animation
- **Feature Cards**: Hover effects with glow and transform
- **Queue Demo**: Animated queue items with progress bars
- **Counters**: Animated number counting on scroll
- **Smooth Transitions**: All interactions have smooth transitions

## Customization

### Colors
Update the CSS custom properties in `:root`:

```css
:root {
    --primary: #00d4ff;
    --secondary: #00ff88;
    --accent: #8b5cf6;
    /* ... other colors */
}
```

### Content
- Update the HTML content in `index.html`
- Modify the demo data in `script.js`
- Adjust animations in `styles.css`

### Performance
- Optimize images and assets
- Minify CSS and JavaScript
- Use a CDN for external libraries

## Performance Features

- **Lazy Loading**: Images and animations load on scroll
- **Optimized Animations**: Hardware-accelerated CSS animations
- **Efficient JavaScript**: Throttled scroll events and optimized selectors
- **Minimal Dependencies**: Only essential external libraries
- **Fast Loading**: Optimized assets and efficient code

## SEO Optimization

- **Meta Tags**: Comprehensive meta tags for social sharing
- **Structured Data**: Semantic HTML for better indexing
- **Performance**: Fast loading times for better rankings
- **Mobile-First**: Responsive design for mobile users
- **Accessibility**: WCAG compliant design

## Future Enhancements

- **Dark/Light Mode Toggle**: Theme switching capability
- **More Interactive Demos**: Additional demo scenarios
- **Blog Section**: News and updates
- **Documentation Integration**: Embedded documentation
- **Analytics**: User behavior tracking
- **PWA Features**: Offline capability and app-like experience

## License

This website is part of the QueueManager project and follows the same MIT license.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues or questions about the website:
- Create an issue on GitHub
- Contact the maintainer
- Check the documentation

---

**Built with ❤️ for the QueueManager project**
