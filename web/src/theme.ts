import { createTheme } from "@mui/material/styles";

export const drawerWidth = 256;
export const drawerBg = "#050f1c";

const kioskCss = {
  html: {
    width: "100%",
    height: "100%",
    overflowX: "hidden",
    overscrollBehaviorX: "none",
  },
  body: {
    width: "100%",
    maxWidth: "100%",
    overflowX: "hidden",
    overscrollBehaviorX: "none",
  },
  "#root": {
    width: "100%",
    maxWidth: "100%",
    minHeight: "100%",
    overflowX: "hidden",
  },
} as const;

let theme = createTheme({
  palette: {
    primary: {
      light: "#4ab4e8",
      main: "#007eb8",
      dark: "#005a94",
    },
    background: { default: "#d5dee3", paper: "#f3f5f6" },
  },
  typography: {
    fontFamily: "Roboto, system-ui, sans-serif",
    h5: {
      fontWeight: 500,
      fontSize: 26,
      letterSpacing: 0.5,
    },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  mixins: {
    toolbar: { minHeight: 48 },
  },
  components: {
    MuiTab: {
      defaultProps: { disableRipple: true },
    },
    MuiCssBaseline: {
      styleOverrides: kioskCss,
    },
  },
});

theme = createTheme(theme, {
  components: {
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: drawerBg },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: "none" },
        contained: {
          boxShadow: "none",
          "&:active": { boxShadow: "none" },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { marginLeft: theme.spacing(1) },
        indicator: {
          height: 3,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          backgroundColor: theme.palette.common.white,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          margin: "0 16px",
          minWidth: 0,
          padding: 0,
          [theme.breakpoints.up("md")]: {
            padding: 0,
            minWidth: 0,
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { padding: theme.spacing(1) },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { borderRadius: 4 },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { backgroundColor: "rgb(255,255,255,0.15)" },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&.Mui-selected": { color: "#3ab0e0" },
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: 14,
          fontWeight: theme.typography.fontWeightMedium,
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          color: "inherit",
          minWidth: "auto",
          marginRight: theme.spacing(2),
          "& svg": { fontSize: 20 },
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small" },
    },
  },
});

export default theme;
