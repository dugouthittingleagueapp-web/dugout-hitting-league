import React, { useState } from 'react';
import { AgeGroup, League } from '../types';

interface NavbarProps {
  currentLeague: AgeGroup | null;
  currentSeason: string;
  leagues: League[];
  userRole: 'fan' | 'umpire' | 'admin';
  showLeagueHomeButton?: boolean;
  onGoHome: () => void;
  onSwitchLeague: () => void;
  onSelectLeague: (leagueId: string) => void;