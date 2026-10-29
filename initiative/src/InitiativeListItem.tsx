import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Input from "@mui/material/Input";
import ListItemIcon from "@mui/material/ListItemIcon";

import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded";

import { InitiativeItem } from "./InitiativeItem";
import { focusInitiativeItem } from "./focusInitiativeItem";

type InitiativeListItemProps = {
  initiative: InitiativeItem;
  onCountChange: (count: string) => void;
  showHidden: boolean;
  editable: boolean;
};

export function InitiativeListItem({
  initiative,
  onCountChange,
  showHidden,
  editable,
}: InitiativeListItemProps) {
  if (!initiative.visible && !showHidden) {
    return null;
  }

  async function handleClick() {
    await focusInitiativeItem(initiative.id);
  }

  return (
    <ListItem
      key={initiative.id}
      secondaryAction={
        <Input
          disableUnderline
          sx={{ width: 48 }}
          inputProps={{
            sx: {
              textAlign: "right",
            },
          }}
          disabled={!editable}
          value={initiative.count}
          onChange={(e) => {
            const newCount = e.target.value;
            onCountChange(newCount);
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      }
      divider
      selected={initiative.active}
      sx={{
        pr: "64px",
        cursor: "pointer",
      }}
      onClick={handleClick}
    >
      {!initiative.visible && showHidden && (
        <ListItemIcon sx={{ minWidth: "30px", opacity: "0.5" }}>
          <VisibilityOffRounded fontSize="small" />
        </ListItemIcon>
      )}
      <ListItemText sx={{ color: "text.primary" }} primary={initiative.name} />
    </ListItem>
  );
}
