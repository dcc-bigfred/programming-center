import type { DrawerProps } from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import HomeIcon from "@mui/icons-material/Home";
import MemoryIcon from "@mui/icons-material/Memory";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { getDecoder, listDecoders } from "../decoders/registry";
import { decoderLabelKey } from "../decoders/types";
import { featuresFor, isFeatureEnabled, listFeatures } from "../features/registry";
import { optionalT } from "../i18n";
import { readQuery, withQuery } from "../query";
import ChangesPanel from "./ChangesPanel";
import ChangeListsNav from "./ChangeListsNav";

const item = {
  py: "2px",
  px: 3,
  color: "rgba(255, 255, 255, 0.7)",
  "&:hover, &:focus": {
    bgcolor: "rgba(255, 255, 255, 0.08)",
  },
    "&.Mui-selected": {
    color: "#3ab0e0",
  },
};

const itemCategory = {
  boxShadow: "0 -1px 0 rgb(255,255,255,0.1) inset",
  py: 1.5,
  px: 3,
};

interface Props extends DrawerProps {
  showSession?: boolean;
  onNavigate?: () => void;
}

export default function Navigator({ showSession = true, onNavigate, ...other }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const decoder = getDecoder(query.decoder);
  const features = decoder ? featuresFor(decoder) : listFeatures();

  return (
    <Drawer variant="permanent" {...other}>
      <List disablePadding>
        <ListItem sx={{ ...item, ...itemCategory, color: "#fff" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <MemoryIcon />
          </ListItemIcon>
          <ListItemText
            primary={t("app.title")}
            primaryTypographyProps={{ fontSize: 20, fontWeight: 500, color: "#fff" }}
          />
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton
            component={Link}
            to={{ pathname: "/", search: withQuery(params, { cv: null }).toString() }}
            selected={location.pathname === "/"}
            onClick={onNavigate}
            sx={item}
          >
            <ListItemIcon>
              <HomeIcon />
            </ListItemIcon>
            <ListItemText>{t("nav.overview")}</ListItemText>
          </ListItemButton>
        </ListItem>

        {showSession && (
          <>
            <Box sx={{ bgcolor: "#0c182c" }}>
              <ListItem sx={{ py: 2, px: 3 }}>
                <ListItemText sx={{ color: "rgba(255,255,255,0.7)" }}>
                  {t("nav.programming")}
                </ListItemText>
              </ListItem>
              <Box sx={{ px: 2, pb: 2 }}>
                <TextField
                  select
                  fullWidth
                  label={t("home.decoder")}
                  value={decoder?.id ?? ""}
                  onChange={(e) =>
                    setParams(withQuery(params, { decoder: e.target.value || null, cv: null }))
                  }
                  sx={{
                    "& .MuiInputBase-root": { color: "#fff" },
                    "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.7)" },
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "rgba(255,255,255,0.23)",
                    },
                    "& .MuiSvgIcon-root": { color: "rgba(255,255,255,0.7)" },
                  }}
                >
                  <MenuItem value="">{t("home.pickDecoder")}</MenuItem>
                  {listDecoders().map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {optionalT(decoderLabelKey(d.id)) ?? d.id}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              {features.map((feature) => {
                const { id, path, Icon } = feature;
                const enabled = isFeatureEnabled(feature, decoder);
                return (
                  <ListItem disablePadding key={id}>
                    {enabled ? (
                      <ListItemButton
                        component={Link}
                        to={{ pathname: path, search: withQuery(params, { cv: null }).toString() }}
                        selected={location.pathname === path}
                        onClick={onNavigate}
                        sx={item}
                      >
                        <ListItemIcon>
                          <Icon />
                        </ListItemIcon>
                        <ListItemText>{t(`features.${id}`)}</ListItemText>
                      </ListItemButton>
                    ) : (
                      <ListItemButton disabled sx={item}>
                        <ListItemIcon>
                          <Icon />
                        </ListItemIcon>
                        <ListItemText>{t(`features.${id}`)}</ListItemText>
                      </ListItemButton>
                    )}
                  </ListItem>
                );
              })}
              <ChangeListsNav decoderId={decoder?.id} />
              <Divider sx={{ mt: 2 }} />
              <ChangesPanel />
            </Box>
            {!decoder && (
              <Typography sx={{ px: 3, py: 2, color: "rgba(255,255,255,0.45)", fontSize: 13 }}>
                {t("home.pickDecoder")}
              </Typography>
            )}
          </>
        )}
      </List>
    </Drawer>
  );
}
