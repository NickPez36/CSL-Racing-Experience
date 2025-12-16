/**
 * Benchmark Generator for Athlete Performance Analyzer
 * 
 * This script generates benchmark files (Q1/Q3 quartiles) for each class
 * based on medallist athlete race data.
 * 
 * Usage: node generate_benchmarks.js
 * 
 * Input files:
 *   - data/medallists.json (list of medallist athletes per class)
 *   - data/dob_list.json (athlete birth years)
 *   - data/{CLASS}-all_wr_data.json (race data per class)
 * 
 * Output files:
 *   - data/{CLASS}_benchmarks.json (one per class)
 */

const fs = require('fs');
const path = require('path');

// === Configuration ===
const DATA_DIR = path.join(__dirname, 'data');
const CLASSES = ['WC1', 'MC1', 'WK1', 'MK1', 'WX1', 'MX1'];

// File naming pattern - all classes use {CLASS}-all_wr_data.json
function getRaceDataFilename(className) {
    return `${className}-all_wr_data.json`;
}

// === Helper Functions ===

/**
 * Normalizes "First LAST" or "LAST, First" to "LAST,FIRST" (matches index.html logic)
 */
function normalizeName(name) {
    if (!name) return "";
    let firstName, lastName;
    name = name.trim();

    if (name.includes(',')) {
        // Format: "LAST, First"
        const parts = name.split(',');
        lastName = parts[0].trim();
        firstName = parts.length > 1 ? parts[1].trim() : "";
    } else {
        // Format: "First LAST", "LAST First", or "First Last"
        const parts = name.split(' ');
        if (parts.length === 1) {
            lastName = parts[0];
            firstName = "";
        } else {
            const isAllCaps = parts.map(p => p.length > 1 && p === p.toUpperCase());

            if (isAllCaps[0] && !isAllCaps[1]) {
                lastName = parts[0];
                firstName = parts.slice(1).join(' ');
            } else if (!isAllCaps[0] && isAllCaps[isAllCaps.length - 1]) {
                lastName = parts.pop();
                firstName = parts.join(' ');
            } else {
                lastName = parts.pop();
                firstName = parts.join(' ');
            }
        }
    }
    return `${lastName.toUpperCase()},${firstName.toUpperCase()}`;
}

/**
 * Calculates the quartile value for an array
 * @param {number[]} values - Sorted array of numbers
 * @param {number} q - Quartile (0.25 for Q1, 0.75 for Q3)
 */
function quartile(values, q) {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;

    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

/**
 * Parses a race string to extract year and quality penalty
 * Format: "rank;competition name with year;qp:penalty_value"
 */
function parseRaceString(raceString) {
    try {
        const parts = raceString.split(';');
        if (parts.length < 3) return null;

        const competition = parts[1].trim();
        const yearRegex = /\b(19[8-9]\d|20\d{2})\b/g;
        const yearMatches = competition.match(yearRegex);
        const year = yearMatches ? parseInt(yearMatches[yearMatches.length - 1]) : null;

        if (!year) return null;

        const qpMatch = parts[2].match(/qp:\s*([\d.]+)/);
        const qualityPenalty = qpMatch ? parseFloat(qpMatch[1]) : null;

        return { year, qualityPenalty, competition };
    } catch (e) {
        return null;
    }
}

/**
 * Extracts all races for an athlete from their data entries
 */
function extractAthletesRaces(athleteEntries) {
    const uniqueRaceStrings = new Set();

    for (const entry of athleteEntries) {
        for (let i = 1; i <= 100; i++) {
            const raceString = entry[`pointsR${i}`];
            if (raceString && raceString.trim() !== "") {
                uniqueRaceStrings.add(raceString);
            }
        }
    }

    const races = [];
    for (const raceString of uniqueRaceStrings) {
        const parsed = parseRaceString(raceString);
        if (parsed && parsed.qualityPenalty !== null) {
            races.push(parsed);
        }
    }

    return races;
}

/**
 * Main function to generate benchmarks for a single class
 */
function generateClassBenchmarks(className, raceData, medallists, dobData) {
    console.log(`\n=== Processing ${className} ===`);
    console.log(`Medallists: ${medallists.length}`);

    // Combine all nation data if structured as object
    let allRaces = [];
    if (Array.isArray(raceData)) {
        allRaces = raceData;
    } else if (typeof raceData === 'object' && raceData !== null) {
        for (const nation of Object.keys(raceData)) {
            if (Array.isArray(raceData[nation])) {
                allRaces = allRaces.concat(raceData[nation]);
            }
        }
    }
    console.log(`Total race entries: ${allRaces.length}`);

    // Build athlete name cache for faster lookup
    const athleteNameCache = new Map();
    for (const entry of allRaces) {
        if (entry.athlete_name) {
            const normName = normalizeName(entry.athlete_name);
            athleteNameCache.set(entry.athlete_name, normName);
        }
    }

    // Process each medallist
    const athleteStats = [];
    let matchedCount = 0;

    for (const medallistName of medallists) {
        // Find all entries for this medallist
        const athleteEntries = allRaces.filter(entry => {
            const normName = athleteNameCache.get(entry.athlete_name) || normalizeName(entry.athlete_name);
            return normName === medallistName;
        });

        if (athleteEntries.length === 0) {
            console.log(`  ⚠ No data found for: ${medallistName}`);
            continue;
        }

        matchedCount++;
        const races = extractAthletesRaces(athleteEntries);

        if (races.length === 0) {
            console.log(`  ⚠ No valid races for: ${medallistName}`);
            continue;
        }

        // Get birth year if available
        const birthYear = dobData[medallistName] || null;

        // Group races by year
        const byYear = {};
        const byAge = {};

        for (const race of races) {
            // By Year
            if (!byYear[race.year]) {
                byYear[race.year] = { races: 0, qpSum: 0, qpCount: 0 };
            }
            byYear[race.year].races++;
            if (race.qualityPenalty !== null) {
                byYear[race.year].qpSum += race.qualityPenalty;
                byYear[race.year].qpCount++;
            }

            // By Age (if DOB available)
            if (birthYear) {
                const age = race.year - birthYear;
                if (age > 0 && age < 100) { // Sanity check
                    if (!byAge[age]) {
                        byAge[age] = { races: 0, qpSum: 0, qpCount: 0 };
                    }
                    byAge[age].races++;
                    if (race.qualityPenalty !== null) {
                        byAge[age].qpSum += race.qualityPenalty;
                        byAge[age].qpCount++;
                    }
                }
            }
        }

        // Calculate cumulative races
        const yearsSorted = Object.keys(byYear).map(Number).sort((a, b) => a - b);
        let cumulativeYear = 0;
        const yearCumulatives = {};
        for (const year of yearsSorted) {
            cumulativeYear += byYear[year].races;
            yearCumulatives[year] = cumulativeYear;
        }

        const agesSorted = Object.keys(byAge).map(Number).sort((a, b) => a - b);
        let cumulativeAge = 0;
        const ageCumulatives = {};
        for (const age of agesSorted) {
            cumulativeAge += byAge[age].races;
            ageCumulatives[age] = cumulativeAge;
        }

        athleteStats.push({
            name: medallistName,
            hasDob: !!birthYear,
            byYear,
            byAge,
            yearCumulatives,
            ageCumulatives
        });
    }

    console.log(`Matched medallists: ${matchedCount}`);

    // Aggregate across all medallists to calculate Q1/Q3
    const benchmarks = {
        byYear: {},
        byAge: {}
    };

    // Collect all years and ages
    const allYears = new Set();
    const allAges = new Set();

    for (const athlete of athleteStats) {
        Object.keys(athlete.byYear).forEach(y => allYears.add(parseInt(y)));
        Object.keys(athlete.byAge).forEach(a => allAges.add(parseInt(a)));
    }

    // Calculate benchmarks by year
    for (const year of [...allYears].sort((a, b) => a - b)) {
        const racesPerPeriod = [];
        const cumulativeRaces = [];
        const avgQualityPenalty = [];

        for (const athlete of athleteStats) {
            if (athlete.byYear[year]) {
                const data = athlete.byYear[year];
                racesPerPeriod.push(data.races);

                if (athlete.yearCumulatives[year]) {
                    cumulativeRaces.push(athlete.yearCumulatives[year]);
                }

                if (data.qpCount > 0) {
                    avgQualityPenalty.push(data.qpSum / data.qpCount);
                }
            }
        }

        if (racesPerPeriod.length >= 2) { // Need at least 2 data points for quartiles
            benchmarks.byYear[year] = {
                racesPerPeriod: {
                    q1: quartile(racesPerPeriod, 0.25),
                    q3: quartile(racesPerPeriod, 0.75)
                },
                cumulativeRaces: {
                    q1: quartile(cumulativeRaces, 0.25),
                    q3: quartile(cumulativeRaces, 0.75)
                },
                avgQualityPenalty: {
                    q1: quartile(avgQualityPenalty, 0.25),
                    q3: quartile(avgQualityPenalty, 0.75)
                }
            };
        }
    }

    // Calculate benchmarks by age
    for (const age of [...allAges].sort((a, b) => a - b)) {
        const racesPerPeriod = [];
        const cumulativeRaces = [];
        const avgQualityPenalty = [];

        for (const athlete of athleteStats) {
            if (!athlete.hasDob) continue; // Skip athletes without DOB for age-based stats

            if (athlete.byAge[age]) {
                const data = athlete.byAge[age];
                racesPerPeriod.push(data.races);

                if (athlete.ageCumulatives[age]) {
                    cumulativeRaces.push(athlete.ageCumulatives[age]);
                }

                if (data.qpCount > 0) {
                    avgQualityPenalty.push(data.qpSum / data.qpCount);
                }
            }
        }

        if (racesPerPeriod.length >= 2) { // Need at least 2 data points for quartiles
            benchmarks.byAge[age] = {
                racesPerPeriod: {
                    q1: quartile(racesPerPeriod, 0.25),
                    q3: quartile(racesPerPeriod, 0.75)
                },
                cumulativeRaces: {
                    q1: quartile(cumulativeRaces, 0.25),
                    q3: quartile(cumulativeRaces, 0.75)
                },
                avgQualityPenalty: {
                    q1: quartile(avgQualityPenalty, 0.25),
                    q3: quartile(avgQualityPenalty, 0.75)
                }
            };
        }
    }

    console.log(`Years with benchmarks: ${Object.keys(benchmarks.byYear).length}`);
    console.log(`Ages with benchmarks: ${Object.keys(benchmarks.byAge).length}`);

    return benchmarks;
}

// === Main Execution ===

async function main() {
    console.log('=== Benchmark Generator ===\n');

    // Load medallists
    const medallistsPath = path.join(DATA_DIR, 'medallists.json');
    const medallistsData = JSON.parse(fs.readFileSync(medallistsPath, 'utf8'));
    console.log('✓ Loaded medallists.json');

    // Load DOB data
    const dobPath = path.join(DATA_DIR, 'dob_list.json');
    const dobRaw = JSON.parse(fs.readFileSync(dobPath, 'utf8'));
    const dobData = {};
    for (const athlete of dobRaw) {
        const normName = normalizeName(athlete.athlete_name);
        if (normName && athlete.birth_year) {
            dobData[normName] = parseInt(athlete.birth_year);
        }
    }
    console.log(`✓ Loaded dob_list.json (${Object.keys(dobData).length} athletes with DOB)`);

    // Process each class
    for (const className of CLASSES) {
        const raceDataPath = path.join(DATA_DIR, getRaceDataFilename(className));

        if (!fs.existsSync(raceDataPath)) {
            console.log(`\n⚠ Skipping ${className}: Race data file not found`);
            continue;
        }

        const raceData = JSON.parse(fs.readFileSync(raceDataPath, 'utf8'));
        const medallists = medallistsData[className]?.athletes || [];

        if (medallists.length === 0) {
            console.log(`\n⚠ Skipping ${className}: No medallists defined`);
            continue;
        }

        const benchmarks = generateClassBenchmarks(className, raceData, medallists, dobData);

        // Write output file
        const outputPath = path.join(DATA_DIR, `${className}_benchmarks.json`);
        fs.writeFileSync(outputPath, JSON.stringify(benchmarks, null, 2));
        console.log(`✓ Written: ${className}_benchmarks.json`);
    }

    console.log('\n=== Complete ===');
}

main().catch(console.error);
