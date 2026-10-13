export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202124", paper: "#f8f9fa",
        g: { blue: "#1a73e8", blueDark: "#1558d6", blueTint: "#e8f0fe", text: "#202124", sub: "#5f6368", line: "#dadce0", hover: "#f1f3f4", red: "#d93025", green: "#188038", amber: "#f9ab00" },
        sev: { low: "#2e9e5b", mod: "#e8b923", high: "#ee7d22", severe: "#d93a2b", ext: "#7b1230" },
      },
      fontFamily: { sans: ["Roboto", "Arial", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)",
        float: "0 2px 4px rgba(0,0,0,.2), 0 -1px 0 rgba(0,0,0,.02)",
      },
    },
  },
  plugins: [],
};
