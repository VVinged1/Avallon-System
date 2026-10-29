import React from "react";

import CardHeader from "@mui/material/CardHeader";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";

export function InitiativeHeader({
  subtitle,
  action,
}: {
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <>
      <CardHeader
        title="Avallon Initiative"
        sx={{p:1,py:.5,flexShrink:0}}
        action={action}
        titleTypographyProps={{
          sx: {
            fontSize: "1rem",
            fontWeight: "bold",
            lineHeight: "28px",
            color: "text.primary",
          },
        }}
      />
      <Divider variant="middle" />
      {subtitle && (
        <Typography
          variant="caption"
          title={subtitle}
          sx={{
            px: 2,
            py: .5,
            fontSize:11,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
            display: "inline-block",
            color: "text.secondary",
          }}
        >
          {subtitle}
        </Typography>
      )}
    </>
  );
}
